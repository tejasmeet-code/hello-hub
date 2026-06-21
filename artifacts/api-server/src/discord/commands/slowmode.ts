import {
  ChannelType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set slowmode on a channel.")
    .addIntegerOption(o => o.setName("seconds").setDescription("Slowmode delay (0 = disable, max 21600)").setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption(o => o.setName("channel").setDescription("Target channel (defaults to current)").setRequired(false).addChannelTypes(ChannelType.GuildText))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "slowmode"))) return;

    const seconds = interaction.options.getInteger("seconds", true);
    const rawChannel = interaction.options.getChannel("channel") ?? interaction.channel;

    if (!rawChannel || !("setRateLimitPerUser" in rawChannel)) {
      await interaction.reply({ embeds: [errorEmbed("Invalid channel", "That channel doesn't support slowmode.")] , flags: 1 << 6 });
      return;
    }

    try {
      await (rawChannel as any).setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
    } catch {
      await interaction.reply({ embeds: [errorEmbed("Failed", "Could not set slowmode — check my permissions.")] , flags: 1 << 6 });
      return;
    }

    const label = seconds === 0 ? "Slowmode disabled" : `Slowmode set`;
    await interaction.reply({
      embeds: [prettyEmbed({
        title: label,
        description: `${CE.settings.str}\n\n${buildBullets([
          { label: "Channel", value: `<#${rawChannel.id}>` },
          { label: "Delay",   value: seconds === 0 ? "Disabled" : `**${seconds}s**` },
          { label: "Set by",  value: `<@${interaction.user.id}>` },
        ])}`,
        color: seconds === 0 ? COLORS.success : COLORS.warning,
      })],
      flags: 1 << 6,
    });
  },
};

export default command;