import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

const WORDS = [
  "apple", "banana", "cherry", "dolphin", "engine", "forest", "garden",
  "hammer", "island", "jacket", "kitten", "lemon", "monkey", "needle",
  "octopus", "pepper", "quilt", "rabbit", "salmon", "tiger", "umbrella",
  "violin", "window", "yellow", "mango", "candle", "library", "market",
  "orange", "picnic", "ranger", "simple", "tunnel", "victory", "harbor",
  "journey", "knight", "lantern", "miracle", "planet",
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXY".split("");
const MAX_WRONG = 6;
const STAGES = [
  "```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========\n```",
  "```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========\n```",
  "```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========\n```",
  "```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========\n```",
  "```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========\n```",
  "```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========\n```",
  "```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========\n```",
];

function masked(word: string, guessed: Set<string>): string {
  return word
    .toUpperCase()
    .split("")
    .map((c) => (guessed.has(c) ? c : "_"))
    .join(" ");
}

function rows(
  guessed: Set<string>,
  finished: boolean,
): ActionRowBuilder<ButtonBuilder>[] {
  return [0, 5, 10, 15, 20].map((start) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ALPHABET.slice(start, start + 5).map((letter) =>
        new ButtonBuilder()
          .setCustomId(`hm:${letter}`)
          .setLabel(letter)
          .setStyle(
            guessed.has(letter) ? ButtonStyle.Secondary : ButtonStyle.Primary,
          )
          .setDisabled(finished || guessed.has(letter)),
      ),
    ),
  );
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("hangman")
    .setDescription("Guess the word, one letter at a time."),
  async execute(interaction: ChatInputCommandInteraction) {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)].toUpperCase();
    const guessed = new Set<string>();
    let wrong = 0;

    function body(finished: boolean, won: boolean): string {
      const headline = finished
        ? won
          ? `${CE.giveaway.str} You got it! The word was **${word}**.`
          : `${CE.dead.str} Out of guesses. The word was **${word}**.`
        : `${CE.rope.str} Guess the word — ${MAX_WRONG - wrong} wrong guess${MAX_WRONG - wrong === 1 ? "" : "es"} left.`;
      return `${headline}\n${STAGES[wrong]}\n\`${masked(word, guessed)}\``;
    }

    const reply = await interaction.reply({
      content: body(false, false),
      components: rows(guessed, false),
      withResponse: true,
    });

    const message = reply.resource?.message as Message | undefined;
    if (!message) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 3 * 60_000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on("collect", async (i) => {
      const letter = i.customId.split(":")[1];
      if (guessed.has(letter)) {
        await i.reply({ content: "Already tried that letter.", ephemeral: true });
        return;
      }
      guessed.add(letter);
      if (!word.includes(letter)) wrong += 1;

      const won = word.split("").every((c) => guessed.has(c));
      const lost = wrong >= MAX_WRONG;
      const finished = won || lost;
      await i.update({
        content: body(finished, won),
        components: rows(guessed, finished),
      });
      if (finished) collector.stop("done");
    });

    collector.on("end", async (_, reason) => {
      if (reason === "done") return;
      await message
        .edit({
          content: `⌛ Game expired. The word was **${word}**.`,
          components: rows(guessed, true),
        })
        .catch(() => {});
    });
  },
};

export default command;
