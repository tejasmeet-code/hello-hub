import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("vckick")
    .setDescription("Disconnect a member from their voice channel.")
    .addUserOption(o => o.setName("user").setDescription("Member to disconnect").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(256))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "vckick"))) return;
    if (!interaction.guild) return;

    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? `Disconnected by ${interaction.user.tag}`;

    // Defer before async API calls to avoid the 3-second Discord timeout
    await interaction.deferReply();

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ embeds: [errorEmbed("Not in server", "That user is not in this server.")] });
      return;
    }
    if (!member.voice.channel) {
      await interaction.editReply({ embeds: [errorEmbed("Not in voice", `**${target.tag}** is not in a voice channel.`)] });
      return;
    }

    const fromChannel = member.voice.channel;
    try {
      await member.voice.disconnect(reason);
    } catch {
      await interaction.editReply({ embeds: [errorEmbed("Failed", "Could not disconnect that user — check my permissions.")] });
      return;
    }

    await interaction.editReply({
      embeds: [prettyEmbed({
        title: "Disconnected from voice",
        description: `${CE.success.str}\n\n${buildBullets([
          { label: "User",    value: `<@${target.id}> — ${target.tag}` },
          { label: "Channel", value: `<#${fromChannel.id}>` },
          { label: "Reason",  value: reason },
        ])}`,
        thumbnail: target.displayAvatarURL({ size: 256 }),
        color: COLORS.success,
      })],
    });
  },
};

export default command;