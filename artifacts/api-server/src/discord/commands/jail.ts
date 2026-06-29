import {
  SlashCommandBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { applyJailToMember, ensureJailRole } from "../storage/jail";
import { recordModStat } from "../storage/modstats";
import { bumpModAction } from "../storage/quota";
import { getGuildConfig, getModerationConfig } from "../storage/config";
import { createCase } from "../storage/cases";
import { sendPunishmentDM } from "../utils/punishDM";
import { COLORS, CE, prettyEmbed, buildBullets, successEmbed, errorEmbed } from "../utils/embedStyle";
import { propagatePunishment, formatPropagationResults } from "../utils/crossServer";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("jail")
    .setDescription("Restrict a user by giving them the Jailed role.")
    .addUserOption((o) => o.setName("user").setDescription("The user to jail").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the jail").setRequired(false).setMaxLength(512))
    .addStringOption((o) => o.setName("proof").setDescription("Link to proof (optional)").setRequired(false))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "jail"))) return;
    if (!interaction.guild || !interaction.guildId) return;

    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? "No reason provided";
    const proof = interaction.options.getString("proof");

    if (target.id === interaction.user.id) { await interaction.reply({ content: "You can't jail yourself." , flags: 1 << 6 }); return; }
    if (target.id === interaction.client.user.id) { await interaction.reply({ content: "I can't jail myself." , flags: 1 << 6 }); return; }

    await interaction.deferReply();

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) { await interaction.editReply("That user isn't in this server."); return; }
    if (!member.manageable) { await interaction.editReply("I can't jail that user — they may have a higher role than me."); return; }

    const roleId = await ensureJailRole(interaction.guild);
    if (!roleId) { await interaction.editReply("Couldn't create or find the Jailed role. I need Manage Roles and Manage Channels permissions."); return; }

    if (member.roles.cache.has(roleId)) { await interaction.editReply(`**${target.tag}** is already jailed.`); return; }

    const me = interaction.guild.members.me;
    if (!me) { await interaction.editReply("I couldn't read my own member info."); return; }

    let removed = 0, couldNotRemove = 0;
    try {
      const result = await applyJailToMember(member, roleId, me, reason);
      removed = result.removed.length;
      couldNotRemove = result.couldNotRemove.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await interaction.editReply(`Failed to apply the Jailed role: ${msg}. Make sure my role is above all member roles and I have Manage Roles permission.`);
      return;
    }

    {
      const { safeDispatchModAction } = await import("../utils/automations");
      safeDispatchModAction({ guild: interaction.guild, action: "jail", moderator: interaction.user, target, reason });
    }

    const crossResults = await propagatePunishment(interaction.client, interaction.guildId, {
      type: "jail",
      userId: target.id,
      reason,
    });

    // Create case — Supabase failure must never break the jail
    let caseNumber = 0;
    try {
      const caseEntry = await createCase({ guildId: interaction.guildId, action: "jail", moderatorId: interaction.user.id, targetId: target.id, reason, proof });
      caseNumber = caseEntry.case_number;
    } catch {
      // Case creation failed — continue without a case number
    }

    const cfg = await getGuildConfig(interaction.guildId);
    const modCfg = getModerationConfig(cfg);
    const allowAppealButton = cfg.modules.appeals && Boolean(cfg.channels.appeals);

    // DM gated by dmOnAction config setting
    const dmSent = modCfg.dmOnAction ? await sendPunishmentDM(target, {
      action: "jail",
      serverName: interaction.guild.name,
      reason,
      caseNumber,
      guildId: interaction.guildId,
      proof,
      includeAppealButton: allowAppealButton,
    }) : false;

    await recordModStat({ guildId: interaction.guildId, modId: interaction.user.id, targetId: target.id, action: "jail", delta: 1, reason });
    await bumpModAction(interaction.guildId, interaction.user.id, cfg.quotaConfig?.weekStartDay ?? 0);

    const label = caseNumber ? `Jailed — Case #${caseNumber}` : "Jailed";
    const replyBullets: { label: string; value: string }[] = [
      { label: "User",   value: target.tag },
      { label: "Reason", value: reason },
    ];
    if (removed > 0)        replyBullets.push({ label: "Roles stripped", value: `${removed}` });
    if (couldNotRemove > 0) replyBullets.push({ label: "Could not strip", value: `${CE.warning.str} ${couldNotRemove} role${couldNotRemove === 1 ? "" : "s"}` });
    const crossNote = formatPropagationResults(crossResults);
    if (crossNote) replyBullets.push({ label: "Cross-server", value: crossNote });
    if (!dmSent)            replyBullets.push({ label: "Note", value: `${CE.warning.str} Could not DM the user (DMs may be disabled)` });

    await interaction.editReply({
      embeds: [prettyEmbed({
        title:       label,
        description: `${CE.success.str}\n\n${buildBullets(replyBullets)}`,
        thumbnail:   target.displayAvatarURL({ size: 256 }),
        color:       COLORS.success,
        footer:      caseNumber ? `Case #${caseNumber}` : "Jail recorded",
      })],
    });

    // Post to moderation log channel
    const modChannelId = cfg.channels.moderation;
    if (modChannelId) {
      const modChannel = await interaction.guild.channels.fetch(modChannelId).catch(() => null);
      if (modChannel && modChannel.type === ChannelType.GuildText) {
        await (modChannel as GuildTextBasedChannel).send({
          embeds: [prettyEmbed({
            title:       `Jail${caseNumber ? ` — Case #${caseNumber}` : ""}`,
            description: `${CE.moderation.str}\n\n${buildBullets([
              { label: "User",      value: `<@${target.id}> — ${target.tag}` },
              { label: "Moderator", value: `<@${interaction.user.id}>` },
              { label: "Reason",    value: reason },
              ...(proof ? [{ label: "Proof", value: proof }] : []),
            ])}`,
            thumbnail: target.displayAvatarURL({ size: 256 }),
            color:  COLORS.neutral,
            footer: caseNumber ? `Case #${caseNumber} • Relosta Bot` : "Relosta Bot",
          })],
        }).catch(() => {});
      }
    }
  },
};

export default command;