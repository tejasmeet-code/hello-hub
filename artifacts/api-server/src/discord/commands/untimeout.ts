import { ChannelType, SlashCommandBuilder, type GuildTextBasedChannel, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";
import { getGuildConfig } from "../storage/config";
import { createCase } from "../storage/cases";
import { recordModStat } from "../storage/modstats";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove a Discord native timeout from a user.")
    .addUserOption(o => o.setName("user").setDescription("User to un-timeout").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(256))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "untimeout"))) return;
    if (!interaction.guild) return;

    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? `Removed by ${interaction.user.tag}`;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({ embeds: [errorEmbed("Not in server", "That user is not in this server.")] , flags: 1 << 6 });
      return;
    }
    if (!member.isCommunicationDisabled()) {
      await interaction.reply({ embeds: [errorEmbed("Not timed out", `**${target.tag}** is not currently timed out.`)] , flags: 1 << 6 });
      return;
    }

    try {
      await member.timeout(null, reason);
    } catch {
      await interaction.reply({ embeds: [errorEmbed("Failed", "Could not remove the timeout — check my permissions.")] , flags: 1 << 6 });
      return;
    }

    const cfg = await getGuildConfig(interaction.guildId!);
    const caseData = await createCase({
      guildId: interaction.guildId!, action: "untimeout",
      moderatorId: interaction.user.id, targetId: target.id, reason,
    }).catch(() => null);
    const caseNumber = caseData?.case_number ?? 0;
    await recordModStat({ guildId: interaction.guildId!, modId: interaction.user.id, targetId: target.id, action: "untimeout", delta: -1, reason });

    await interaction.reply({
      embeds: [prettyEmbed({
        title: caseNumber ? `Timeout Removed — Case #${caseNumber}` : "Timeout Removed",
        description: `${CE.success.str}\n\n${buildBullets([
          { label: "User",   value: `<@${target.id}> — ${target.tag}` },
          { label: "Reason", value: reason },
        ])}`,
        thumbnail: target.displayAvatarURL({ size: 256 }),
        color: COLORS.success,
        footer: caseNumber ? `Case #${caseNumber}` : "Untimeout recorded",
      })],
      flags: 1 << 6,
    });

    const modChannelId = cfg.channels.moderation;
    if (modChannelId && interaction.guild) {
      const modChannel = await interaction.guild.channels.fetch(modChannelId).catch(() => null);
      if (modChannel && modChannel.type === ChannelType.GuildText) {
        await (modChannel as GuildTextBasedChannel).send({
          embeds: [prettyEmbed({
            title: `Untimeout${caseNumber ? ` — Case #${caseNumber}` : ""}`,
            description: `${CE.success.str}\n\n${buildBullets([
              { label: "User",      value: `<@${target.id}> — ${target.tag}` },
              { label: "Moderator", value: `<@${interaction.user.id}>` },
              { label: "Reason",    value: reason },
            ])}`,
            thumbnail: target.displayAvatarURL({ size: 256 }),
            color: COLORS.success,
            footer: caseNumber ? `Case #${caseNumber} • Relosta Bot` : "Relosta Bot",
          })],
        }).catch(() => {});
      }
    }
  },
};

export default command;