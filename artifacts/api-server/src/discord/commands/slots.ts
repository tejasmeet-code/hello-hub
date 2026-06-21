import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

const SYMBOLS = [
  CE.slot_cherry.str,
  CE.slot_lemon.str,
  CE.slot_grape.str,
  CE.slot_bell.str,
  CE.slot_diamond.str,
  CE.slot_seven.str,
];

function spin(): string {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Pull the slot machine."),
  async execute(interaction: ChatInputCommandInteraction) {
    const reels = [spin(), spin(), spin()];
    const allMatch = reels[0] === reels[1] && reels[1] === reels[2];
    const twoMatch =
      !allMatch &&
      (reels[0] === reels[1] ||
        reels[1] === reels[2] ||
        reels[0] === reels[2]);

    let outcome: string;
    if (allMatch && reels[0] === CE.slot_seven.str) outcome = `${CE.jackpot.str} **JACKPOT!** ${CE.jackpot.str}`;
    else if (allMatch) outcome = `${CE.big_win.str} **Big win!** ${CE.big_win.str}`;
    else if (twoMatch) outcome = `${CE.small_win.str} Small win.`;
    else outcome = `${CE.dead.str} No luck. Try again.`;

    await interaction.reply(
      `${CE.slots.str}  | ${reels.join(" | ")} |  ${CE.slots.str}\n${outcome}`,
    );
  },
};

export default command;
