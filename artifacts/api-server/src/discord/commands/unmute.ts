import {
  ChannelType,
  SlashCommandBuilder,
  type GuildTextBasedChannel,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { CE, COLORS, prettyEmbed, buildBullets } from "../utils/embedStyle";
import { getGuildConfig } from "../storage/config";
import { createCase } from "../storage/cases";
import { recordModStat } from "../storage/modstats";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove a timeout (mute) from a user.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to unmute")
        .setRequired(true),
    )
    .setDMPermission(false),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "unmute"))) return;
    if (!interaction.guild) return;

    const target = interaction.options.getUser("user", true);
    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (!member) {
      await interaction.reply({
        content: "That user isn't in this server.",
        ephemeral: true,
      });
      return;
    }

    if (!member.isCommunicationDisabled()) {
      await interaction.reply({
        content: "That user isn't currently muted.",
        ephemeral: true,
      });
      return;
    }

    if (!member.moderatable) {
      await interaction.reply({
        content: "I can't unmute that user.",
        ephemeral: true,
      });
      return;
    }

    const cfg = await getGuildConfig(interaction.guildId!);
    const caseData = await createCase({
      guildId: interaction.guildId!, action: "unmute",
      moderatorId: interaction.user.id, targetId: target.id, reason: "Unmuted",
    }).catch(() => null);
    const caseNumber = caseData?.case_number ?? 0;

    try {
      await member.timeout(null, `Unmuted by ${interaction.user.tag}`);
      await recordModStat({ guildId: interaction.guildId!, modId: interaction.user.id, targetId: target.id, action: "unmute", delta: -1, reason: "Unmuted" });

      await interaction.reply({
        embeds: [prettyEmbed({
          title: caseNumber ? `Unmuted — Case #${caseNumber}` : "Unmuted",
          description: `${CE.success.str}\n\n${buildBullets([
            { label: "User", value: target.tag },
          ])}`,
          thumbnail: target.displayAvatarURL({ size: 256 }),
          color: COLORS.success,
          footer: caseNumber ? `Case #${caseNumber}` : "Unmute recorded",
        })],
      });

      const modChannelId = cfg.channels.moderation;
      if (modChannelId && interaction.guild) {
        const modChannel = await interaction.guild.channels.fetch(modChannelId).catch(() => null);
        if (modChannel && modChannel.type === ChannelType.GuildText) {
          await (modChannel as GuildTextBasedChannel).send({
            embeds: [prettyEmbed({
              title: `Unmute${caseNumber ? ` — Case #${caseNumber}` : ""}`,
              description: `${CE.success.str}\n\n${buildBullets([
                { label: "User",      value: `<@${target.id}> — ${target.tag}` },
                { label: "Moderator", value: `<@${interaction.user.id}>` },
              ])}`,
              thumbnail: target.displayAvatarURL({ size: 256 }),
              color: COLORS.success,
              footer: caseNumber ? `Case #${caseNumber} • Relosta Bot` : "Relosta Bot",
            })],
          }).catch(() => {});
        }
      }
    } catch {
      await interaction.reply({ content: "Failed to unmute that user." });
    }
  },
};

export default command;
