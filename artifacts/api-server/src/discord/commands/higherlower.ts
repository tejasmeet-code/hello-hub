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

function nextCard(): number {
  return Math.floor(Math.random() * 13) + 1;
}

function name(card: number): string {
  if (card === 1) return "A";
  if (card === 11) return "J";
  if (card === 12) return "Q";
  if (card === 13) return "K";
  return String(card);
}

function row(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("hl:higher")
      .setLabel("Higher ⬆️")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("hl:lower")
      .setLabel("Lower ⬇️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("hl:cashout")
      .setLabel("Cash out")
      .setStyle(ButtonStyle.Secondary),
  );
}

async function play(
  message: Message,
  userId: string,
  current: number,
  streak: number,
): Promise<void> {
  try {
    const click = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 30_000,
      filter: (i) => i.user.id === userId,
    });

    if (click.customId === "hl:cashout") {
      await click.update({
        content:
          `🃏 Last card: **${name(current)}**\n` +
          `${CE.cashout.str} You cashed out with a streak of **${streak}**.`,
        components: [],
      });
      return;
    }

    let next = nextCard();
    while (next === current) next = nextCard();

    const guessHigher = click.customId === "hl:higher";
    const correct =
      (guessHigher && next > current) || (!guessHigher && next < current);

    if (!correct) {
      await click.update({
        content:
          `🃏 You had **${name(current)}**, you said **${guessHigher ? "higher" : "lower"}**, next was **${name(next)}**.\n` +
          `${CE.dead.str} Game over. Final streak: **${streak}**.`,
        components: [],
      });
      return;
    }

    const newStreak = streak + 1;
    await click.update({
      content:
        `🃏 You had **${name(current)}**, next was **${name(next)}** — correct!\n` +
        `${CE.streak.str} Streak: **${newStreak}**. Higher or lower?`,
      components: [row()],
    });
    await play(message, userId, next, newStreak);
  } catch {
    await message
      .edit({
        content: "⌛ Game timed out.",
        components: [],
      })
      .catch(() => {});
  }
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("higherlower")
    .setDescription("Higher or lower card game. Build the longest streak."),
  async execute(interaction: ChatInputCommandInteraction) {
    const first = nextCard();
    const reply = await interaction.reply({
      content: `🃏 Card is **${name(first)}**. Higher or lower?`,
      components: [row()],
      withResponse: true,
    });
    const message = reply.resource?.message;
    if (!message) return;
    await play(message, interaction.user.id, first, 0);
  },
};

export default command;
