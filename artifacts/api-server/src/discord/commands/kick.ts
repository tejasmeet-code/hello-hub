import {
  ChannelType,
  type GuildTextBasedChannel,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed, modActionEmbed } from "../utils/embedStyle";
import { propagatePunishment, formatPropagationResults } from "../utils/crossServer";
import { recordModStat } from "../storage/modstats";
import { getGuildConfig, getModerationConfig } from "../storage/config";
import { createCase } from "../storage/cases";
import { sendPunishmentDM } from "../utils/punishDM";
import { bumpModAction } from "../storage/quota";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server.")
    .addUserOption(o => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the kick").setRequired(true).setMaxLength(512))
    .addStringOption(o => o.setName("proof").setDescription("Proof URL").setRequired(false).setMaxLength(512))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "kick"))) return;
    if (!interaction.guild || !interaction.guildId) return;
    await interaction.deferReply();

    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    const proof = interaction.options.getString("proof");

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ embeds: [errorEmbed("User not found", "That user is not in this server.")] });
      return;
    }
    if (!member.kickable) {
      await interaction.editReply({ embeds: [errorEmbed("Cannot kick", "I can't kick this user — check role hierarchy.")] });
      return;
    }

    const cfg = await getGuildConfig(interaction.guildId);
    const modCfg = getModerationConfig(cfg);
    const caseData = await createCase({
      guildId: interaction.guildId, action: "kick",
      moderatorId: interaction.user.id, targetId: target.id, reason, proof,
    }).catch(() => null);
    const caseNumber = caseData?.case_number ?? null;
    const allowAppealButton = cfg.modules.appeals && Boolean(cfg.channels.appeals);

    const dmSent = modCfg.dmOnAction ? await sendPunishmentDM(target, {
      action: "kick", serverName: interaction.guild.name,
      reason, caseNumber: caseNumber ?? 0, guildId: interaction.guildId, proof,
      includeAppealButton: allowAppealButton,
    }) : false;

    try {
      await member.kick(`${reason} — by ${interaction.user.tag}`);
      const { safeDispatchModAction } = await import("../utils/automations");
      safeDispatchModAction({ guild: interaction.guild, action: "kick", moderator: interaction.user, target, reason });
    } catch {
      await interaction.editReply({ embeds: [errorEmbed("Kick failed", "Could not kick that user.")] });
      return;
    }

    const crossResults = await propagatePunishment(interaction.client, interaction.guildId, {
      type: "kick",
      userId: target.id,
      reason,
    });

    await recordModStat({ guildId: interaction.guildId, modId: interaction.user.id, targetId: target.id, action: "kick", delta: 1, reason });
    await bumpModAction(interaction.guildId, interaction.user.id, cfg.quotaConfig?.weekStartDay ?? 0);

    const crossNote = formatPropagationResults(crossResults);

    await interaction.editReply({
      embeds: [modActionEmbed({
        action: caseNumber ? `Kick (Case #${caseNumber})` : "Kick",
        target,
        moderator: interaction.user,
        reason,
        extraFields: [
          ...(proof ? [{ label: "Proof", value: proof }] : []),
          ...(!dmSent ? [{ label: "Note", value: `${CE.warning.str} Could not DM the user` }] : []),
          ...(crossNote ? [{ label: "Cross-server", value: crossNote }] : [])
        ],
        emoji: CE.kick?.str || CE.ban.str
      })]
    });

    const modChannelId = cfg.channels.moderation;
    if (modChannelId) {
      const modChannel = await interaction.guild.channels.fetch(modChannelId).catch(() => null);
      if (modChannel && modChannel.type === ChannelType.GuildText) {
        await (modChannel as GuildTextBasedChannel).send({
          embeds: [modActionEmbed({
            action: caseNumber ? `Kick (Case #${caseNumber})` : "Kick",
            target,
            moderator: interaction.user,
            reason,
            extraFields: proof ? [{ label: "Proof", value: proof }] : []
          })]
        }).catch(() => {});
      }
    }
  },
};

export default command;