import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

const CHOICES = ["rock", "paper", "scissors"] as const;
type Choice = (typeof CHOICES)[number];

const EMOJI: Record<Choice, string> = {
  rock: CE.rps_rock.str,
  paper: CE.rps_paper.str,
  scissors: CE.rps_scissors.str,
};

function decide(player: Choice, bot: Choice): "tie" | "player" | "bot" {
  if (player === bot) return "tie";
  if (
    (player === "rock" && bot === "scissors") ||
    (player === "paper" && bot === "rock") ||
    (player === "scissors" && bot === "paper")
  ) {
    return "player";
  }
  return "bot";
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("rps")
    .setDescription("Play rock paper scissors against the bot.")
    .addStringOption((o) =>
      o
        .setName("choice")
        .setDescription("Your move")
        .setRequired(true)
        .addChoices(
          { name: "Rock", value: "rock" },
          { name: "Paper", value: "paper" },
          { name: "Scissors", value: "scissors" },
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const player = interaction.options.getString("choice", true) as Choice;
    const bot = CHOICES[Math.floor(Math.random() * CHOICES.length)];
    const result = decide(player, bot);
    const verdict =
      result === "tie"
        ? "It's a tie!"
        : result === "player"
          ? `You win! ${CE.giveaway.str}`
          : `I win! ${CE.rps_win.str}`;
    await interaction.reply(
      `You: ${EMOJI[player]} ${player}\nMe: ${EMOJI[bot]} ${bot}\n**${verdict}**`,
    );
  },
};

export default command;
