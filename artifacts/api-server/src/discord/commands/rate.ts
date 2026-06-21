import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

const COMMENTS: Record<string, string[]> = {
  low: ["awful", "terrible", "regret it", "burn it"],
  mid: ["meh", "it exists", "could be worse", "fine I guess"],
  high: ["solid", "I'd recommend", "great", "love it"],
  top: ["incredible", "perfection", "10/10 chef's kiss", "legendary"],
};

function bucket(score: number): string {
  if (score <= 2) return "low";
  if (score <= 5) return "mid";
  if (score <= 8) return "high";
  return "top";
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("rate")
    .setDescription("Get the bot's hot take on something, rated 0-10.")
    .addStringOption((o) =>
      o
        .setName("thing")
        .setDescription("What should I rate?")
        .setRequired(true)
        .setMaxLength(200),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const thing = interaction.options.getString("thing", true);
    const score = Math.floor(Math.random() * 11);
    const pool = COMMENTS[bucket(score)];
    const comment = pool[Math.floor(Math.random() * pool.length)];
    await interaction.reply(
      `${CE.chart.str} I rate **${thing}** a **${score}/10** — ${comment}.`,
    );
  },
};

export default command;
