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
  recordPromotion,
  syncProfileFromMember,
} from "../storage/staff";
import { getGuildConfig } from "../storage/config";
import { buildStaffEmbed } from "../utils/staffEmbed";
import { propagateRoleAssignment } from "../utils/crossServer";
import { logger } from "../../lib/logger";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("promote")
    .setDescription("Promote a staff member up the hierarchy.")
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
          "Required only when skipping more than one position up.",
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
        content: "You aren't allowed to promote staff.",
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
      await interaction.reply({
        content: "Bots can't be staff members.",
        ephemeral: true,
      });
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

    // Determine the member's current staff role from their actual Discord roles.
    const heldEntry =
      roles.find((r) => member.roles.cache.has(r.roleId)) ?? null;

    let targetEntry;
    if (explicitRole) {
      const explicit = await getRoleEntry(interaction.guildId, explicitRole.id);
      if (!explicit) {
        await interaction.reply({
          content: `<@&${explicitRole.id}> isn't a registered staff role.`,
          ephemeral: true,
        });
        return;
      }
      if (heldEntry && explicit.position >= heldEntry.position) {
        await interaction.reply({
          content: "The new role isn't higher than the user's current role.",
          ephemeral: true,
        });
        return;
      }
      targetEntry = explicit;
    } else {
      // Default: one step up.
      if (!heldEntry) {
        await interaction.reply({
          content:
            "User has no staff role. Specify a `new-role` to add them at a specific position.",
          ephemeral: true,
        });
        return;
      }
      if (heldEntry.position === 1) {
        await interaction.reply({
          content: "User is already at the highest staff role.",
          ephemeral: true,
        });
        return;
      }
      const oneUp = roles.find((r) => r.position === heldEntry.position - 1);
      if (!oneUp) {
        await interaction.reply({
          content:
            "Couldn't find a role one position above. Specify `new-role` explicitly.",
          ephemeral: true,
        });
        return;
      }
      targetEntry = oneUp;
    }

    if (heldEntry && heldEntry.position - targetEntry.position > 1 && !explicitRole) {
      await interaction.reply({
        content:
          "That promotion skips more than one position. Specify `new-role` explicitly.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    // Apply roles in Discord.
    try {
      if (heldEntry && heldEntry.roleId !== targetEntry.roleId) {
        await member.roles.remove(heldEntry.roleId, `Promoted by ${interaction.user.tag}`);
      }
      await member.roles.add(targetEntry.roleId, `Promoted by ${interaction.user.tag}`);
    } catch (err) {
      logger.warn({ err }, "promote: role change failed");
      await interaction.editReply(
        "I couldn't change the user's roles. Check that my role is above the staff roles.",
      );
      return;
    }

    await recordPromotion(
      interaction.guildId,
      member.id,
      heldEntry?.roleId ?? null,
      targetEntry.roleId,
      interaction.user.id,
      reason || undefined,
    );
    await syncProfileFromMember(interaction.guildId, member);

    const cross = await propagateRoleAssignment(
      interaction.client,
      guild,
      member.id,
      targetEntry.roleId,
      heldEntry?.roleId ?? null,
      `Promotion mirrored from ${guild.name}`,
    );

    const profile = await getProfile(interaction.guildId, member.id);
    const fields = [
      {
        name: "From",
        value: heldEntry ? `<@&${heldEntry.roleId}>` : "*not yet on staff*",
        inline: true,
      },
      { name: "To", value: `<@&${targetEntry.roleId}>`, inline: true },
      { name: "Promoted by", value: `<@${interaction.user.id}>`, inline: true },
    ];
    if (reason) fields.push({ name: "Reason", value: reason, inline: false });
    if (profile) {
      fields.push({
        name: "Total promotions",
        value: String(profile.promotions.length),
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
      title: `${CE.promotion.str} Promotion`,
      target,
      color: 0x57f287,
      fields,
      footer: `Promotion #${profile?.promotions.length ?? 1}`,
    });

    await interaction.editReply({ embeds: [embed] });

    // Mirror to the configured promotions channel if it isn't this one.
    const cfg = await getGuildConfig(interaction.guildId);
    if (cfg.channels.promotions && cfg.channels.promotions !== interaction.channelId) {
      const ch = await guild.channels
        .fetch(cfg.channels.promotions)
        .catch(() => null);
      if (
        ch &&
        ch.type === ChannelType.GuildText &&
        "send" in ch
      ) {
        await (ch as GuildTextBasedChannel).send({ embeds: [embed] }).catch(() => {});
      }
    }
  },
};

export default command;
