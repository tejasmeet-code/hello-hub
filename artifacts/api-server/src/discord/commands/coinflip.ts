import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flip a coin."),
  async execute(interaction: ChatInputCommandInteraction) {
    const heads = Math.random() < 0.5;
    const face = heads ? "Heads" : "Tails";
    await interaction.reply(`🪙 The coin landed on **${face}**.`);
  },
};

export default command;
