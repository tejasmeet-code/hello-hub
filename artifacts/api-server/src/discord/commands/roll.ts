import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll some dice. Format: NdS (e.g. 2d20).")
    .addStringOption((option) =>
      option
        .setName("dice")
        .setDescription("Dice notation, e.g. 1d6, 2d20, 4d8")
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const input = interaction.options.getString("dice") ?? "1d6";
    const match = /^(\d{1,3})d(\d{1,4})$/i.exec(input.trim());
    if (!match) {
      await interaction.reply({
        content: "Invalid dice format. Use something like `2d20` or `1d100`.",
        ephemeral: true,
      });
      return;
    }
    const count = Number(match[1]);
    const sides = Number(match[2]);
    if (count < 1 || count > 100 || sides < 2 || sides > 1000) {
      await interaction.reply({
        content: "Keep counts between 1-100 and sides between 2-1000.",
        ephemeral: true,
      });
      return;
    }
    const rolls = Array.from(
      { length: count },
      () => Math.floor(Math.random() * sides) + 1,
    );
    const total = rolls.reduce((a, b) => a + b, 0);
    const breakdown = count > 1 ? ` (${rolls.join(" + ")})` : "";
    await interaction.reply(
      `🎲 You rolled **${total}**${breakdown} on \`${count}d${sides}\``,
    );
  },
};

export default command;
