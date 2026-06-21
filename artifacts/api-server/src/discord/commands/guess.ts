import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

interface GameState {
  number: number;
  tries: number;
}

const games = new Map<string, GameState>();

function key(guildId: string | null, userId: string): string {
  return `${guildId ?? "dm"}:${userId}`;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("guess")
    .setDescription(
      "Guess a number between 1 and 100. First guess starts a new game.",
    )
    .addIntegerOption((o) =>
      o
        .setName("number")
        .setDescription("Your guess (1-100)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const guess = interaction.options.getInteger("number", true);
    const k = key(interaction.guildId, interaction.user.id);
    let game = games.get(k);
    if (!game) {
      game = { number: Math.floor(Math.random() * 100) + 1, tries: 0 };
      games.set(k, game);
    }
    game.tries += 1;

    if (guess === game.number) {
      games.delete(k);
      await interaction.reply(
        `${CE.bullseye.str} Got it! The number was **${game.number}**. You took **${game.tries}** guess${game.tries === 1 ? "" : "es"}.`,
      );
      return;
    }

    const hint = guess < game.number ? "higher ⬆️" : "lower ⬇️";
    await interaction.reply(
      `Nope — try **${hint}**. (Guess #${game.tries})`,
    );
  },
};

export default command;
