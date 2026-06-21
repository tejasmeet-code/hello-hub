import {
  ChannelType,
  SlashCommandBuilder,
  PermissionFlagsBits,
  type GuildTextBasedChannel,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { createCase } from "../storage/cases";
import { getGuildConfig, getModerationConfig } from "../storage/config";
import { sendPunishmentDM } from "../utils/punishDM";
import { buildBullets, CE, COLORS, prettyEmbed, errorEmbed } from "../utils/embedStyle";
import { recordModStat } from "../storage/modstats";
import { logger } from "../../lib/logger";

import { bumpModAction } from "../storage/quota";
import { propagatePunishment, formatPropagationResults } from "../utils/crossServer";

function modActionError(err: unknown): string {
  const code = (err as any)?.code;
  if (code === 40002) {
    return "This server requires **2FA for moderation actions**. The bot owner must enable Two-Factor Authentication on their Discord account (User Settings → My Account → Two-Factor Auth) to use mod commands here.";
  }
  if (code === 50013) {
    return "I'm **missing permissions**. Make sure my role has **Ban Members** and is above the target's highest role.";
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `Could not perform this action.\n\`${msg.slice(0, 300)}\``;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user from the server.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to ban")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for the ban")
        .setRequired(false)
        .setMaxLength(512),
    )
    .addIntegerOption((option) =>
      option
        .setName("delete_days")
        .setDescription("Days of messages to delete (0-7)")
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("proof")
        .setDescription("Proof URL")
        .setRequired(false)
        .setMaxLength(512),
    )
    .setDMPermission(false),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "ban"))) return;
    if (!interaction.guild || !interaction.guildId) return;

    const target = interaction.options.getUser("user", true);
    const reason =
      interaction.options.getString("reason") ?? "No reason provided";
    const deleteDays = interaction.options.getInteger("delete_days") ?? 0;
    const proof = interaction.options.getString("proof");

    if (target.id === interaction.user.id) {
      await interaction.reply({
        content: "You can't ban yourself.",
        ephemeral: true,
      });
      return;
    }
    if (target.id === interaction.client.user.id) {
      await interaction.reply({
        content: "I can't ban myself.",
        ephemeral: true,
      });
      return;
    }

    // Defer before async API calls to avoid the 3-second Discord timeout
    await interaction.deferReply();

    // Always fetch fresh — stale guild.members.me cache causes false-positive bannable checks
    const botMember = await interaction.guild.members.fetchMe().catch(() => interaction.guild?.members.me);
    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
      await interaction.editReply({ content: `${CE.error.str} I don't have the **Ban Members** permission. Grant it and try again.` });
      return;
    }

    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (member) {
      if (member.user.id === interaction.guild.ownerId) {
        await interaction.editReply({ content: "I can't ban the server owner." });
        return;
      }
      if (botMember.roles.highest.position <= member.roles.highest.position) {
        await interaction.editReply({ content: "I can't ban that user — they're at or above my highest role." });
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
            "You can't ban a user with a role equal to or higher than your own.",
        });
        return;
      }
    }

    const cfg = await getGuildConfig(interaction.guildId).catch(() => null);
    const modCfg = cfg ? getModerationConfig(cfg) : { dmOnAction: false };
    const caseData = await createCase({
      guildId: interaction.guildId,
      action: "ban",
      moderatorId: interaction.user.id,
      targetId: target.id,
      reason,
      proof,
    }).catch(() => null);
    const caseNumber = caseData?.case_number ?? 0;
    const dmSent = modCfg.dmOnAction ? await sendPunishmentDM(target, {
      action: "ban",
      serverName: interaction.guild.name,
      reason,
      caseNumber,
      guildId: interaction.guildId,
      proof,
      appealServerInvite: cfg?.appealServerInvite,
      includeAppealButton: Boolean(cfg?.modules?.appeals) && Boolean(cfg?.channels?.appeals),
    }) : false;

    try {
      await interaction.guild.members.ban(target.id, {
        reason: `${reason} — by ${interaction.user.tag}`.slice(0, 512),
        deleteMessageSeconds: deleteDays * 86400,
      });
      const { safeDispatchModAction } = await import("../utils/automations");
      safeDispatchModAction({ guild: interaction.guild, action: "ban", moderator: interaction.user, target, reason });
      const crossResults = await propagatePunishment(interaction.client, interaction.guildId!, {
        type: "ban", userId: target.id, reason,
      });
      await recordModStat({ guildId: interaction.guildId!, modId: interaction.user.id, targetId: target.id, action: "ban", delta: 1, reason });
      await bumpModAction(interaction.guildId!, interaction.user.id, cfg?.quotaConfig?.weekStartDay ?? 0);

      const crossNote = formatPropagationResults(crossResults);
      const bullets = [
        { label: "User", value: target.tag },
        { label: "Reason", value: reason },
        ...(proof ? [{ label: "Proof", value: proof }] : []),
        ...(!dmSent ? [{ label: "Note", value: `${CE.warning.str} Could not DM the user` }] : []),
        ...(crossNote ? [{ label: "Cross-server", value: crossNote }] : []),
      ];
      await interaction.editReply({
        embeds: [prettyEmbed({
          title: caseNumber ? `Banned — Case #${caseNumber}` : "Banned",
          description: `${CE.moderation.str}\n\n${buildBullets(bullets)}`,
          thumbnail: target.displayAvatarURL({ size: 256 }),
          color: COLORS.danger,
          footer: caseNumber ? `Case #${caseNumber}` : "Ban recorded",
        })],
      });

      const modChannelId = cfg?.channels?.moderation;
      if (modChannelId) {
        const modChannel = await interaction.guild!.channels.fetch(modChannelId).catch(() => null);
        if (modChannel && modChannel.type === ChannelType.GuildText) {
          await (modChannel as GuildTextBasedChannel).send({
            embeds: [prettyEmbed({
              title: `Ban${caseNumber ? ` — Case #${caseNumber}` : ""}`,
              description: `${CE.moderation.str}\n\n${buildBullets([
                { label: "User",      value: `<@${target.id}> — ${target.tag}` },
                { label: "Moderator", value: `<@${interaction.user.id}>` },
                { label: "Reason",    value: reason },
                ...(proof ? [{ label: "Proof", value: proof }] : []),
                ...(deleteDays > 0 ? [{ label: "Deleted messages", value: `${deleteDays} day(s)` }] : []),
              ])}`,
              thumbnail: target.displayAvatarURL({ size: 256 }),
              color: COLORS.danger,
              footer: caseNumber ? `Case #${caseNumber} • Relosta Bot` : "Relosta Bot",
            })],
          }).catch(() => {});
        }
      }
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId, targetId: target.id }, "ban: ban() failed");
      await interaction.editReply({ embeds: [errorEmbed("Failed", modActionError(err))] });
    }
  },
};

export default command;
