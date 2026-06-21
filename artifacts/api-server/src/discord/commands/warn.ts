import {
  ChannelType,
  SlashCommandBuilder,
  type GuildTextBasedChannel,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  addWarning,
  clearWarnings,
  getWarnings,
} from "../storage/warnings";
import { ensureWhitelisted } from "../utils/gate";
import { createCase } from "../storage/cases";
import { getGuildConfig, getModerationConfig } from "../storage/config";
import { sendPunishmentDM } from "../utils/punishDM";
import { buildBullets, CE, COLORS, prettyEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member, view their warnings, or clear them.")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Issue a warning to a user.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The user to warn")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Reason for the warning")
            .setRequired(true)
            .setMaxLength(512),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List a user's warnings.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The user to look up")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Clear all warnings for a user.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The user to clear")
            .setRequired(true),
        ),
    )
    .setDMPermission(false),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "warn"))) return;
    if (!interaction.guildId) return;

    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser("user", true);
    const guildId = interaction.guildId;

    if (sub === "add") {
      if (target.bot) {
        await interaction.reply({
          content: "You can't warn a bot.",
          ephemeral: true,
        });
        return;
      }
      if (target.id === interaction.user.id) {
        await interaction.reply({
          content: "You can't warn yourself.",
          ephemeral: true,
        });
        return;
      }
      const reason = interaction.options.getString("reason", true);
      const warning = await addWarning({
        guildId,
        userId: target.id,
        moderatorId: interaction.user.id,
        reason,
      });
      {
        const { safeDispatchModAction } = await import("../utils/automations");
        safeDispatchModAction({ guild: interaction.guild!, action: "warn", moderator: interaction.user, target, reason });
      }
      const total = (await getWarnings(guildId, target.id)).length;
      const cfg = await getGuildConfig(guildId);
      const modCfg = getModerationConfig(cfg);
      const caseData = await createCase({
        guildId,
        action: "warn",
        moderatorId: interaction.user.id,
        targetId: target.id,
        reason,
      }).catch(() => null);
      const caseNumber = caseData?.case_number ?? 0;

      const dmSent = modCfg.dmOnAction ? await sendPunishmentDM(target, {
        action: "warn",
        serverName: interaction.guild?.name ?? "this server",
        reason,
        caseNumber,
        guildId,
        includeAppealButton: cfg.modules.appeals && Boolean(cfg.channels.appeals),
      }) : false;

      await interaction.reply({
        embeds: [prettyEmbed({
          title: caseNumber ? `Warned — Case #${caseNumber}` : "Warned",
          description: `${CE.warning.str}\n\n${buildBullets([
            { label: "User", value: target.tag },
            { label: "Reason", value: reason },
            { label: "Warnings", value: `${total}` },
            ...(!dmSent ? [{ label: "Note", value: `${CE.warning.str} Could not DM the user` }] : []),
          ])}`,
          thumbnail: target.displayAvatarURL({ size: 256 }),
          color: COLORS.warning,
          footer: caseNumber ? `Case #${caseNumber}` : `Warning ${warning.id}`,
        })],
        ephemeral: true,
      });

      const modChannelId = cfg.channels.moderation;
      if (modChannelId && interaction.guild) {
        const modChannel = await interaction.guild.channels.fetch(modChannelId).catch(() => null);
        if (modChannel && modChannel.type === ChannelType.GuildText) {
          await (modChannel as GuildTextBasedChannel).send({
            embeds: [prettyEmbed({
              title: `Warning${caseNumber ? ` — Case #${caseNumber}` : ""}`,
              description: `${CE.warning.str}\n\n${buildBullets([
                { label: "User",      value: `<@${target.id}> — ${target.tag}` },
                { label: "Moderator", value: `<@${interaction.user.id}>` },
                { label: "Reason",    value: reason },
                { label: "Total warnings", value: String(total) },
              ])}`,
              thumbnail: target.displayAvatarURL({ size: 256 }),
              color: COLORS.warning,
              footer: caseNumber ? `Case #${caseNumber} • Relosta Bot` : "Relosta Bot",
            })],
          }).catch(() => {});
        }
      }
      return;
    }

    if (sub === "list") {
      const warnings = await getWarnings(guildId, target.id);
      if (warnings.length === 0) {
        await interaction.reply({
          content: `**${target.tag}** has no warnings.`,
          ephemeral: true,
        });
        return;
      }
      const embed = prettyEmbed({
        title: `Warnings for ${target.tag}`,
        color: COLORS.warning,
        thumbnail: target.displayAvatarURL({ size: 128 }),
        description:
          warnings
            .slice(-15)
            .map(
              (w, i) =>
                `**${i + 1}.** <t:${Math.floor(w.timestamp / 1000)}:f> by <@${w.moderatorId}>\n> ${w.reason}`,
            )
            .join("\n\n"),
        footer: `${warnings.length} total warning${warnings.length === 1 ? "" : "s"}`,
      });
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === "clear") {
      const removed = await clearWarnings(guildId, target.id);
      if (removed === 0) {
        await interaction.reply({
          content: `**${target.tag}** had no warnings to clear.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        content: `${CE.success.str} Cleared **${removed}** warning${removed === 1 ? "" : "s"} for **${target.tag}**.`,
        ephemeral: true,
      });
      return;
    }
  },
};

export default command;
