import {
  ChannelType,
  SlashCommandBuilder,
  PermissionFlagsBits,
  type GuildTextBasedChannel,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { CE, COLORS, prettyEmbed, buildBullets, errorEmbed } from "../utils/embedStyle";
import { getGuildConfig, getModerationConfig } from "../storage/config";
import { logger } from "../../lib/logger";
import { createCase } from "../storage/cases";

import { recordModStat } from "../storage/modstats";
import { bumpModAction } from "../storage/quota";
import { sendPunishmentDM } from "../utils/punishDM";

function modActionError(err: unknown): string {
  const code = (err as any)?.code;
  if (code === 40002) {
    return "This server requires **2FA for moderation actions**. The bot owner must enable Two-Factor Authentication on their Discord account (User Settings → My Account → Two-Factor Auth) to use mod commands here.";
  }
  if (code === 50013) {
    return "I'm **missing permissions**. Make sure my role has **Moderate Members** and is above the target's highest role.";
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `Could not perform this action.\n\`${msg.slice(0, 300)}\``;
}

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const MAX_TIMEOUT_MS = 28 * 86_400_000; // Discord max: 28 days

function parseDuration(input: string): number | null {
  const match = /^(\d{1,5})\s*(s|m|h|d)$/i.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const ms = value * UNIT_MS[unit];
  if (ms <= 0 || ms > MAX_TIMEOUT_MS) return null;
  return ms;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Timeout (mute) a user for a duration. Max 28 days.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to mute")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("duration")
        .setDescription("How long, e.g. 30s, 10m, 2h, 1d")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for the mute")
        .setRequired(false)
        .setMaxLength(512),
    )
    .setDMPermission(false),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "mute"))) return;
    if (!interaction.guild) return;

    const target = interaction.options.getUser("user", true);
    const durationInput = interaction.options.getString("duration", true);
    const reason =
      interaction.options.getString("reason") ?? "No reason provided";

    const ms = parseDuration(durationInput);
    if (ms === null) {
      await interaction.reply({
        content:
          "Invalid duration. Use a number followed by `s`, `m`, `h`, or `d` (max 28d). Examples: `30s`, `10m`, `2h`, `7d`.",
        ephemeral: true,
      });
      return;
    }

    if (target.id === interaction.user.id) {
      await interaction.reply({
        content: "You can't mute yourself.",
        ephemeral: true,
      });
      return;
    }
    if (target.id === interaction.client.user.id) {
      await interaction.reply({
        content: "I can't mute myself.",
        ephemeral: true,
      });
      return;
    }

    // Defer before async API calls to avoid the 3-second Discord timeout
    await interaction.deferReply();

    // Always fetch fresh — stale guild.members.me cache causes false-positive moderatable checks
    const botMember = await interaction.guild.members.fetchMe().catch(() => interaction.guild?.members.me);
    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.editReply({ content: `${CE.error.str} I don't have the **Moderate Members** permission. Grant it and try again.` });
      return;
    }

    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (!member) {
      await interaction.editReply({ content: "That user isn't in this server." });
      return;
    }

    // Explicit check: target must not be owner AND bot must outrank target
    if (member.user.id === interaction.guild.ownerId) {
      await interaction.editReply({ content: "I can't mute the server owner." });
      return;
    }
    if (botMember.roles.highest.position <= member.roles.highest.position) {
      await interaction.editReply({ content: "I can't mute that user — they're at or above my highest role." });
      return;
    }

    const invoker = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (
      invoker &&
      invoker.roles.highest.position <= member.roles.highest.position &&
      interaction.guild.ownerId !== invoker.id
    ) {
      await interaction.editReply({
        content:
          "You can't mute a user with a role equal to or higher than your own.",
      });
      return;
    }

    const cfg = await getGuildConfig(interaction.guildId!).catch(() => null);
    const modCfg = cfg ? getModerationConfig(cfg) : { dmOnAction: false };
    const caseData = await createCase({
      guildId: interaction.guildId!, action: "mute",
      moderatorId: interaction.user.id, targetId: target.id, reason,
    }).catch(() => null);
    const caseNumber = caseData?.case_number ?? 0;
    const dmSent = modCfg.dmOnAction ? await sendPunishmentDM(target, {
      action: "mute", serverName: interaction.guild!.name,
      reason, caseNumber, guildId: interaction.guildId!,
      includeAppealButton: Boolean(cfg?.modules?.appeals) && Boolean(cfg?.channels?.appeals),
    }) : false;

    try {
      const auditReason = `${reason} — by ${interaction.user.tag}`.slice(0, 512);
      await member.timeout(ms, auditReason);
      const until = Math.floor((Date.now() + ms) / 1000);
      await recordModStat({ guildId: interaction.guildId!, modId: interaction.user.id, targetId: target.id, action: "mute", delta: 1, reason });
      await bumpModAction(interaction.guildId!, interaction.user.id, cfg?.quotaConfig?.weekStartDay ?? 0);

      await interaction.editReply({
        embeds: [prettyEmbed({
          title: caseNumber ? `Muted — Case #${caseNumber}` : "Muted",
          description: `${CE.mute.str}\n\n${buildBullets([
            { label: "User",     value: target.tag },
            { label: "Duration", value: `<t:${until}:R>` },
            { label: "Reason",   value: reason },
            ...(!dmSent ? [{ label: "Note", value: `${CE.warning.str} Could not DM the user` }] : []),
          ])}`,
          thumbnail: target.displayAvatarURL({ size: 256 }),
          color: COLORS.warning,
          footer: caseNumber ? `Case #${caseNumber}` : "Mute recorded",
        })],
      });

      const modChannelId = cfg?.channels?.moderation;
      if (modChannelId) {
        const modChannel = await interaction.guild!.channels.fetch(modChannelId).catch(() => null);
        if (modChannel && modChannel.type === ChannelType.GuildText) {
          await (modChannel as GuildTextBasedChannel).send({
            embeds: [prettyEmbed({
              title: `Mute${caseNumber ? ` — Case #${caseNumber}` : ""}`,
              description: `${CE.mute.str}\n\n${buildBullets([
                { label: "User",      value: `<@${target.id}> — ${target.tag}` },
                { label: "Moderator", value: `<@${interaction.user.id}>` },
                { label: "Duration",  value: `Until <t:${until}:R> (${durationInput})` },
                { label: "Reason",    value: reason },
              ])}`,
              thumbnail: target.displayAvatarURL({ size: 256 }),
              color: COLORS.warning,
              footer: caseNumber ? `Case #${caseNumber} • Relosta Bot` : "Relosta Bot",
            })],
          }).catch(() => {});
        }
      }
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId, targetId: target.id }, "mute: timeout() failed");
      await interaction.editReply({ embeds: [errorEmbed("Failed", modActionError(err))] });
    }
  },
};

export default command;
