import {
  ChannelType,
  type GuildTextBasedChannel,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed, modActionEmbed } from "../utils/embedStyle";
import { recordModStat } from "../storage/modstats";
import { getGuildConfig, getModerationConfig } from "../storage/config";
import { bumpModAction } from "../storage/quota";
import { createCase } from "../storage/cases";
import { sendPunishmentDM } from "../utils/punishDM";

const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_MS = 28 * 86_400_000;

function parseDuration(str: string): number | null {
  const m = str.trim().match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  if (!m) return null;
  const ms = parseFloat(m[1]!) * (UNIT_MS[m[2]!.toLowerCase()] ?? 0);
  return ms > 0 && ms <= MAX_MS ? Math.round(ms) : null;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Apply a Discord native timeout (blocks all interactions).")
    .addUserOption(o => o.setName("user").setDescription("User to timeout").setRequired(true))
    .addStringOption(o => o.setName("duration").setDescription("Duration e.g. 30m, 2h, 1d (max 28d)").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(512))
    .addStringOption(o => o.setName("proof").setDescription("Proof URL").setRequired(false).setMaxLength(512))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "timeout"))) return;
    if (!interaction.guild || !interaction.guildId) return;
    await interaction.deferReply();

    const target = interaction.options.getUser("user", true);
    const durationInput = interaction.options.getString("duration", true);
    const reason = interaction.options.getString("reason", true);
    const proof = interaction.options.getString("proof");

    const ms = parseDuration(durationInput);
    if (!ms) {
      await interaction.editReply({ embeds: [errorEmbed("Invalid duration", "Use a format like `30m`, `2h`, `1d` (max 28 days).")] });
      return;
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ embeds: [errorEmbed("Not in server", "That user is not in this server.")] });
      return;
    }
    if (!member.moderatable) {
      await interaction.editReply({ embeds: [errorEmbed("Cannot timeout", "I can't timeout this user — check role hierarchy.")] });
      return;
    }

    try {
      await member.timeout(ms, `${reason} — by ${interaction.user.tag}`);
    } catch {
      await interaction.editReply({ embeds: [errorEmbed("Timeout failed", "Could not apply timeout.")] });
      return;
    }

    const cfg = await getGuildConfig(interaction.guildId);
    const modCfg = getModerationConfig(cfg);
    const caseData = await createCase({
      guildId: interaction.guildId,
      action: "mute",
      moderatorId: interaction.user.id,
      targetId: target.id,
      reason,
      proof,
    }).catch(() => null);
    const caseNumber = caseData?.case_number ?? 0;
    const dmSent = modCfg.dmOnAction ? await sendPunishmentDM(target, {
      action: "mute",
      serverName: interaction.guild.name,
      reason,
      caseNumber,
      guildId: interaction.guildId,
      proof,
      includeAppealButton: cfg.modules.appeals && Boolean(cfg.channels.appeals),
    }) : false;
    await recordModStat({ guildId: interaction.guildId, modId: interaction.user.id, targetId: target.id, action: "mute", delta: 1, reason });
    await bumpModAction(interaction.guildId, interaction.user.id, cfg.quotaConfig?.weekStartDay ?? 0);

    const until = Math.floor((Date.now() + ms) / 1000);
    await interaction.editReply({
      embeds: [modActionEmbed({
        action: caseNumber ? `Timeout (Case #${caseNumber})` : "Timeout",
        target,
        moderator: interaction.user,
        duration: durationInput,
        reason,
        extraFields: [
          { label: "Until", value: `<t:${until}:R>` },
          ...(!dmSent ? [{ label: "Note", value: `${CE.warning.str} Could not DM the user` }] : []),
        ],
        emoji: "⏳",
        color: COLORS.success
      })]
    });

    const modChannelId = cfg.channels.moderation;
    if (modChannelId) {
      const modChannel = await interaction.guild.channels.fetch(modChannelId).catch(() => null);
      if (modChannel && modChannel.type === ChannelType.GuildText) {
        await (modChannel as GuildTextBasedChannel).send({
          embeds: [modActionEmbed({
            action: caseNumber ? `Timeout (Case #${caseNumber})` : "Timeout",
            target,
            moderator: interaction.user,
            duration: durationInput,
            reason,
            extraFields: [
              { label: "Until", value: `<t:${until}:R>` },
              ...(proof ? [{ label: "Proof", value: proof }] : []),
            ],
            color: COLORS.warning
          })]
        }).catch(() => {});
      }
    }
  },
};

export default command;