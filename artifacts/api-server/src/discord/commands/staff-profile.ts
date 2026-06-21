import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  getActiveInfractions,
  getProfile,
  listStaffRoles,
  syncProfileFromMember,
} from "../storage/staff";
import { getQuota } from "../storage/quota";
import { getGuildConfig } from "../storage/config";
import { getConnectedGuildId } from "../storage/connections";
import { summarizeMod } from "../storage/modstats";
import { logger } from "../../lib/logger";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-profile")
    .setDescription(
      "Staff profile: promotions, demotions, join date, main-server modstats & messages.",
    )
    .setDMPermission(false)
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Staff member (defaults to you)")
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", flags: 1 << 6 });
      return;
    }

    const target = interaction.options.getUser("user", false) ?? interaction.user;
    if (target.bot) {
      await interaction.reply({ content: "Bots can't have staff profiles.", flags: 1 << 6 });
      return;
    }

    await interaction.deferReply();

    try {
      const sourceGuild = interaction.guild;
      const sourceMember = await sourceGuild.members
        .fetch(target.id)
        .catch(() => null);
      if (sourceMember) {
        await syncProfileFromMember(interaction.guildId, sourceMember).catch(() => {});
      }

      const main = await resolveMainGuild(interaction.client, sourceGuild);

      const profile = await getProfile(interaction.guildId, target.id);
      const roles = await listStaffRoles(interaction.guildId);

      const heldEntry =
        sourceMember &&
        roles.find((r) => sourceMember.roles.cache.has(r.roleId));
      const currentRoleLine = heldEntry
        ? `<@&${heldEntry.roleId}> (position **${heldEntry.position}**)`
        : profile?.terminated
          ? "*terminated*"
          : "*not on staff*";

      const promoCount = profile?.promotions.length ?? 0;
      const demoCount = profile?.demotions.length ?? 0;
      const activeInfractions = profile ? getActiveInfractions(profile) : [];
      const warningCount = activeInfractions.filter((i) => i.type === "warning").length;
      const strikeCount = activeInfractions.filter((i) => i.type === "strike").length;
      const recentInfractions = profile
        ? [...profile.infractions].sort((a, b) => b.at - a.at).slice(0, 5)
        : [];
      const recentPromos = profile
        ? [...profile.promotions].sort((a, b) => b.at - a.at).slice(0, 3)
        : [];
      const recentDemos = profile
        ? [...profile.demotions].sort((a, b) => b.at - a.at).slice(0, 3)
        : [];

      let joinedAt: number | null = null;
      let joinedSource = "this server";
      if (main.guild) {
        const mainMember = await main.guild.members
          .fetch(target.id)
          .catch(() => null);
        if (mainMember?.joinedTimestamp) {
          joinedAt = mainMember.joinedTimestamp;
          joinedSource = main.label;
        }
      }
      if (joinedAt === null && sourceMember?.joinedTimestamp) {
        joinedAt = sourceMember.joinedTimestamp;
      }

      const mainGuildId = main.guild?.id ?? interaction.guildId;
      const mainCfg = await getGuildConfig(mainGuildId);
      const weekStartDay = mainCfg.quotaConfig?.weekStartDay ?? 0;

      const [modAllTime, mainQuota] = await Promise.all([
        summarizeMod(mainGuildId, target.id, "all_time", weekStartDay),
        getQuota(mainGuildId, target.id),
      ]);
      const totalMessages = mainQuota.weekly.reduce((sum, w) => sum + w.messages, 0);

      const embed = new EmbedBuilder()
        .setTitle(`Staff Profile — ${target.tag}`)
        .setColor(0x9b59b6)
        .setThumbnail(target.displayAvatarURL({ size: 256, extension: "png" }))
        .setDescription(
          `<@${target.id}> · ${currentRoleLine}` +
          (profile?.terminated ? "\n*This staff member has been terminated.*" : ""),
        )
        .addFields(
          {
            name: `${CE.promotion.str} Promotions`,
            value: String(promoCount),
            inline: true,
          },
          {
            name: `${CE.demotion.str} Demotions`,
            value: String(demoCount),
            inline: true,
          },
          {
            name: `${CE.warning.str} Warnings`,
            value: String(warningCount),
            inline: true,
          },
          {
            name: `${CE.termination.str} Strikes`,
            value: String(strikeCount),
            inline: true,
          },
          {
            name: `${CE.information.str} Joined`,
            value: joinedAt
              ? `<t:${Math.floor(joinedAt / 1000)}:F>\n*<t:${Math.floor(joinedAt / 1000)}:R>* — ${joinedSource}`
              : "Unknown",
            inline: false,
          },
          {
            name: `${CE.moderation.str} Modstats — ${main.label}`,
            value:
              `Total: **${modAllTime.total}**` +
              ` · Positive: **${modAllTime.positive}** · Negative: **${modAllTime.negative}**`,
            inline: false,
          },
          {
            name: `${CE.notifications.str} Messages — ${main.label}`,
            value: `**${totalMessages.toLocaleString()}** (lifetime tracked)`,
            inline: false,
          },
        );

      if (recentPromos.length > 0) {
        embed.addFields({
          name: `${CE.promotion.str} Recent promotions`,
          value: recentPromos
            .map((p) => `• <@&${p.toRoleId}> by <@${p.byUserId}> · <t:${Math.floor(p.at / 1000)}:R>`)
            .join("\n"),
          inline: false,
        });
      }
      if (recentDemos.length > 0) {
        embed.addFields({
          name: `${CE.demotion.str} Recent demotions`,
          value: recentDemos
            .map((d) => `• ${d.toRoleId ? `to <@&${d.toRoleId}>` : "*terminated*"} by <@${d.byUserId}> · <t:${Math.floor(d.at / 1000)}:R>`)
            .join("\n"),
          inline: false,
        });
      }
      if (recentInfractions.length > 0) {
        embed.addFields({
          name: `${CE.warning.str} Recent infractions`,
          value: recentInfractions
            .map((inf) => {
              const expiry = inf.expiresAt
                ? inf.expiresAt < Date.now()
                  ? " · expired"
                  : ` · expires <t:${Math.floor(inf.expiresAt / 1000)}:R>`
                : "";
              return `• **${inf.type}** by <@${inf.byUserId}> · <t:${Math.floor(inf.at / 1000)}:R>${expiry}`;
            })
            .join("\n"),
          inline: false,
        });
      }

      embed.setFooter({
        text: main.guild
          ? `Main server: ${main.guild.name}`
          : "No main server connected — showing this server's data.",
      });
      embed.setTimestamp(new Date());

      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId, target: target.id }, "staff-profile failed");
      try {
        await interaction.editReply(
          `${CE.error.str} Couldn't build that staff profile. The server log has the details.`,
        );
      } catch {
        /* nothing else to do */
      }
    }
  },
};

interface MainGuildResolution {
  guild: Guild | null;
  label: string;
}

async function resolveMainGuild(
  client: Client,
  sourceGuild: Guild,
): Promise<MainGuildResolution> {
  const link = await getConnectedGuildId(sourceGuild.id);
  if (!link) {
    return { guild: sourceGuild, label: "this server" };
  }
  if (link.mainGuildId === sourceGuild.id) {
    return { guild: sourceGuild, label: `main (${sourceGuild.name})` };
  }
  const mainGuild = await client.guilds.fetch(link.mainGuildId).catch(() => null);
  if (!mainGuild) {
    return { guild: sourceGuild, label: "this server (main unreachable)" };
  }
  return { guild: mainGuild, label: `main (${mainGuild.name})` };
}

export default command;