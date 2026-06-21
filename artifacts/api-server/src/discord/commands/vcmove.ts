import { ChannelType, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("vcmove")
    .setDescription("Move a member to a different voice channel.")
    .addUserOption(o => o.setName("user").setDescription("Member to move").setRequired(true))
    .addChannelOption(o => o.setName("channel").setDescription("Destination voice channel").setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(256))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "vcmove"))) return;
    if (!interaction.guild) return;

    const target = interaction.options.getUser("user", true);
    const destChannel = interaction.options.getChannel("channel", true);
    const reason = interaction.options.getString("reason") ?? `Moved by ${interaction.user.tag}`;

    // Defer before async API calls to avoid the 3-second Discord timeout
    await interaction.deferReply({ flags: 1 << 6 });

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
      await member.voice.setChannel(destChannel.id, reason);
    } catch {
      await interaction.editReply({ embeds: [errorEmbed("Failed", "Could not move that user — check my permissions.")] });
      return;
    }

    await interaction.editReply({
      embeds: [prettyEmbed({
        title: "Moved to voice channel",
        description: `${CE.success.str}\n\n${buildBullets([
          { label: "User", value: `<@${target.id}> — ${target.tag}` },
          { label: "From", value: `<#${fromChannel.id}>` },
          { label: "To",   value: `<#${destChannel.id}>` },
        ])}`,
        thumbnail: target.displayAvatarURL({ size: 256 }),
        color: COLORS.success,
      })],
    });
  },
};

export default command;