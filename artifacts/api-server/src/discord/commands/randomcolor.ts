import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";

function pad(n: number): string {
  return n.toString(16).padStart(2, "0");
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("randomcolor")
    .setDescription("Generate a random color."),
  async execute(interaction: ChatInputCommandInteraction) {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    const hex = `#${pad(r)}${pad(g)}${pad(b)}`.toUpperCase();
    const numeric = (r << 16) | (g << 8) | b;

    const embed = new EmbedBuilder()
      .setTitle(`🎨 ${hex}`)
      .setDescription(`RGB(${r}, ${g}, ${b})`)
      .setColor(numeric)
      .setImage(`https://singlecolorimage.com/get/${hex.slice(1)}/200x80.png`);

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
