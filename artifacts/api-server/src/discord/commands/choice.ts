import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { prettyEmbed, COLORS, CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("choice")
    .setDescription("Pick a random option from a comma-separated list.")
    .addStringOption(o => o.setName("options").setDescription("Options separated by commas e.g. apple, banana, orange").setRequired(true).setMaxLength(500))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    const raw = interaction.options.getString("options", true);
    const items = raw.split(",").map(s => s.trim()).filter(Boolean);

    if (items.length < 2) {
      await interaction.reply({ content: "Give me at least 2 options separated by commas!" , flags: 1 << 6 });
      return;
    }

    const picked = items[Math.floor(Math.random() * items.length)]!;
    await interaction.reply({
      embeds: [prettyEmbed({
        title: "The choice is...",
        description: `${CE.success.str}\n\n**${picked}**\n\n*Chosen from ${items.length} options.*`,
        color: COLORS.primary,
      })],
    });
  },
};

export default command;