import {
  SlashCommandBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { isManager } from "../utils/staffPerms";
import {
  getProfile,
  getRoleEntry,
  listStaffRoles,
  recordDemotion,
  recordInfraction,
  syncProfileFromMember,
} from "../storage/staff";
import { getDemotionsConfig, getGuildConfig } from "../storage/config";
import { buildStaffEmbed } from "../utils/staffEmbed";
import { CE } from "../utils/embedStyle";
import { propagateRoleAssignment } from "../utils/crossServer";
import {
  propagateTermination,
  terminateInGuild,
} from "../utils/staffActions";
import { logger } from "../../lib/logger";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("demote")
    .setDescription("Demote a staff member down the hierarchy.")
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName("user").setDescription("Staff member").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("reason")
        .setDescription("Reason (logged on profile)")
        .setRequired(false),
    )
    .addRoleOption((o) =>
      o
        .setName("new-role")
        .setDescription(
          "Required only when skipping more than one position down.",
        )
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", ephemeral: true });
      return;
    }
    if (!(await isManager(interaction))) {
      await interaction.reply({
        content: "You aren't allowed to demote staff.",
        ephemeral: true,
      });
      return;
    }
    const guild = interaction.guild;
    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", false) ?? "";
    const explicitRole = interaction.options.getRole("new-role", false);

    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({
        content: "That user isn't in this server.",
        ephemeral: true,
      });
      return;
    }
    if (target.bot) {
      await interaction.reply({ content: "Bots can't be staff.", ephemeral: true });
      return;
    }

    const roles = await listStaffRoles(interaction.guildId);
    if (roles.length === 0) {
      await interaction.reply({
        content:
          "No staff roles registered yet. Use `/staff-role-add` to set up the hierarchy first.",
        ephemeral: true,
      });
      return;
    }
    const lowestPos = Math.max(...roles.map((r) => r.position));
    const heldEntry =
      roles.find((r) => member.roles.cache.has(r.roleId)) ?? null;

    if (!heldEntry) {
      await interaction.reply({
        content: "User has no staff role to demote from.",
        ephemeral: true,
      });
      return;
    }

    let isTermination = false;
    let targetEntry: typeof heldEntry | null = null;

    if (heldEntry.position === lowestPos && !explicitRole) {
      // Demoting from the lowest = termination.
      isTermination = true;
    } else if (explicitRole) {
      const explicit = await getRoleEntry(interaction.guildId, explicitRole.id);
      if (!explicit) {
        await interaction.reply({
          content: `<@&${explicitRole.id}> isn't a registered staff role.`,
          ephemeral: true,
        });
        return;
      }
      if (explicit.position <= heldEntry.position) {
        await interaction.reply({
          content: "The new role isn't lower than the user's current role.",
          ephemeral: true,
        });
        return;
      }
      targetEntry = explicit;
    } else {
      const oneDown = roles.find((r) => r.position === heldEntry.position + 1);
      if (!oneDown) {
        await interaction.reply({
          content: "Couldn't find a role one position below.",
          ephemeral: true,
        });
        return;
      }
      targetEntry = oneDown;
    }

    if (
      !isTermination &&
      targetEntry &&
      targetEntry.position - heldEntry.position > 1 &&
      !explicitRole
    ) {
      await interaction.reply({
        content:
          "That demotion skips more than one position. Specify `new-role` explicitly.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const auditReason = `Demoted by ${interaction.user.tag}${reason ? `: ${reason}` : ""}`;
    let cross: {
      propagated: boolean;
      otherGuildId?: string;
      note?: string;
    };

    try {
      if (isTermination) {
        // Terminate: strip every staff role in this server.
        await terminateInGuild(guild, member, auditReason);
        const t = await propagateTermination(
          interaction.client,
          guild,
          member.id,
          `Termination mirrored from ${guild.name}`,
        );
        cross = {
          propagated: t.propagated,
          ...(t.otherGuildId !== undefined ? { otherGuildId: t.otherGuildId } : {}),
          ...(t.note !== undefined ? { note: t.note } : {}),
        };
      } else {
        await member.roles.remove(heldEntry.roleId, auditReason);
        if (targetEntry) {
          await member.roles.add(targetEntry.roleId, auditReason);
        }
        cross = await propagateRoleAssignment(
          interaction.client,
          guild,
          member.id,
          targetEntry?.roleId ?? null,
          heldEntry.roleId,
          `Demotion mirrored from ${guild.name}`,
        );
      }
    } catch (err) {
      logger.warn({ err }, "demote: role change failed");
      await interaction.editReply(
        "I couldn't change the user's roles. Check that my role is above the staff roles.",
      );
      return;
    }

    await recordDemotion(
      interaction.guildId,
      member.id,
      heldEntry.roleId,
      targetEntry?.roleId ?? null,
      interaction.user.id,
      reason || undefined,
    );

    // Auto-add demotion infraction (and termination if applicable).
    await recordInfraction(
      interaction.guildId,
      member.id,
      isTermination ? "termination" : "demotion",
      interaction.user.id,
      reason || (isTermination ? "Terminated via demotion from lowest role." : "Demotion."),
    );

    await syncProfileFromMember(interaction.guildId, member);

    const profile = await getProfile(interaction.guildId, member.id);
    const fields = [
      { name: "From", value: `<@&${heldEntry.roleId}>`, inline: true },
      {
        name: "To",
        value: targetEntry ? `<@&${targetEntry.roleId}>` : "*Terminated*",
        inline: true,
      },
      { name: "Demoted by", value: `<@${interaction.user.id}>`, inline: true },
    ];
    if (reason) fields.push({ name: "Reason", value: reason, inline: false });
    if (profile) {
      fields.push({
        name: "Total demotions",
        value: String(profile.demotions.length),
        inline: true,
      });
    }
    if (cross.otherGuildId) {
      fields.push({
        name: "Connected server",
        value: cross.propagated
          ? `${CE.success.str} Mirrored to \`${cross.otherGuildId}\``
          : `${CE.warning.str} ${cross.note ?? "Not mirrored"}`,
        inline: false,
      });
    }

    const embed = buildStaffEmbed({
      title: isTermination ? `${CE.termination.str} Termination` : `${CE.demotion.str} Demotion`,
      target,
      color: isTermination ? 0xed4245 : 0xfaa61a,
      fields,
      footer: isTermination
        ? "Demoted from the lowest staff role — terminated."
        : `Demotion #${profile?.demotions.length ?? 1}`,
    });

    await interaction.editReply({ embeds: [embed] });

    const cfg = await getGuildConfig(interaction.guildId);
    if (getDemotionsConfig(cfg).dmMember) {
      await target.send({ embeds: [embed] }).catch(() => {});
    }
    if (cfg.channels.demotions && cfg.channels.demotions !== interaction.channelId) {
      const ch = await guild.channels
        .fetch(cfg.channels.demotions)
        .catch(() => null);
      if (ch && ch.type === ChannelType.GuildText && "send" in ch) {
        await (ch as GuildTextBasedChannel).send({ embeds: [embed] }).catch(() => {});
      }
    }
  },
};

export default command;
