import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

const FORTUNES = [
  "An exciting opportunity lies ahead — say yes.",
  "A pleasant surprise is waiting for you this week.",
  "Today, your kindness will come back to you in full.",
  "Trust the process — the dots will connect later.",
  "A small action today will change your tomorrow.",
  "You will soon meet someone who shifts your perspective.",
  "Take the long way home today — something good is on the path.",
  "Patience now will pay you back tenfold.",
  "Your hard work is being noticed — keep going.",
  "Don't overthink it. The first instinct is right.",
  "A creative idea will come to you when you least expect it.",
  "Money flows toward those who give freely.",
  "Reach out to an old friend — they're thinking of you too.",
  "What you're searching for is already in your hands.",
  "Rest is productive. Take it without guilt.",
  "A door you thought was closed is actually unlocked.",
  "Speak up today — your voice is needed.",
  "The thing you fear is smaller than you think.",
  "Adventure favors the prepared. Pack a bag.",
  "Tomorrow brings clarity. Sleep on the decision.",
];

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("fortune")
    .setDescription("Crack open a fortune cookie."),
  async execute(interaction: ChatInputCommandInteraction) {
    const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
    const lucky = Array.from({ length: 6 }, () =>
      Math.floor(Math.random() * 49) + 1,
    )
      .sort((a, b) => a - b)
      .join(" • ");
    await interaction.reply(
      `${CE.fortune.str} **${fortune}**\n\n${CE.slots.str} Lucky numbers: ${lucky}`,
    );
  },
};

export default command;
