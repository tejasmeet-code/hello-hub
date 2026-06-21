import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";

const WORDS = [
  "elephant", "guitar", "mountain", "keyboard", "discord",
  "javascript", "puzzle", "rainbow", "library", "umbrella",
  "computer", "dragon", "treasure", "blanket", "pancake",
  "chocolate", "spaceship", "vinegar", "telescope", "calendar",
];

function scramble(word: string): string {
  const letters = word.split("");
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const result = letters.join("");
  return result === word ? scramble(word) : result;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("wordscramble")
    .setDescription("Unscramble a random word."),
  async execute(interaction: ChatInputCommandInteraction) {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const scrambled = scramble(word);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("wordscramble:reveal")
        .setLabel("Reveal answer")
        .setStyle(ButtonStyle.Secondary),
    );

    const reply = await interaction.reply({
      content: `🔤 Unscramble this: **\`${scrambled}\`** (${word.length} letters)`,
      components: [row],
      withResponse: true,
    });

    const message = reply.resource?.message;
    if (!message) return;

    try {
      const click = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 60_000,
      });
      await click.reply({
        content: `The word was **${word}**.`,
        ephemeral: true,
      });
    } catch {
      await interaction
        .editReply({
          content: `🔤 Unscramble this: **\`${scrambled}\`** — the word was **${word}**.`,
          components: [],
        })
        .catch(() => {});
    }
  },
};

export default command;
