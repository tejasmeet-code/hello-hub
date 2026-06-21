import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { EMOJI_SUCCESS, EMOJI_ERROR } from "../utils/emojis";

interface Question {
  q: string;
  choices: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
}

const QUESTIONS: Question[] = [
  { q: "What is the capital of Australia?", choices: ["Sydney", "Melbourne", "Canberra", "Perth"], answer: 2 },
  { q: "Which planet has the most moons?", choices: ["Jupiter", "Saturn", "Uranus", "Neptune"], answer: 1 },
  { q: "Who painted the Mona Lisa?", choices: ["Michelangelo", "Raphael", "Leonardo da Vinci", "Donatello"], answer: 2 },
  { q: "What year did World War II end?", choices: ["1942", "1944", "1945", "1947"], answer: 2 },
  { q: "What is the largest ocean on Earth?", choices: ["Atlantic", "Indian", "Arctic", "Pacific"], answer: 3 },
  { q: "Which language has the most native speakers?", choices: ["English", "Mandarin", "Spanish", "Hindi"], answer: 1 },
  { q: "What is the smallest prime number?", choices: ["0", "1", "2", "3"], answer: 2 },
  { q: "Who wrote '1984'?", choices: ["Aldous Huxley", "George Orwell", "Ray Bradbury", "H.G. Wells"], answer: 1 },
  { q: "What is the chemical symbol for gold?", choices: ["Go", "Gd", "Au", "Ag"], answer: 2 },
  { q: "How many continents are there?", choices: ["5", "6", "7", "8"], answer: 2 },
  { q: "Which country gifted the Statue of Liberty to the US?", choices: ["UK", "France", "Spain", "Italy"], answer: 1 },
  { q: "What is the speed of light (approx, km/s)?", choices: ["150,000", "200,000", "300,000", "450,000"], answer: 2 },
  { q: "Which gas do plants absorb from the air?", choices: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], answer: 2 },
  { q: "What is the longest river in the world?", choices: ["Amazon", "Nile", "Yangtze", "Mississippi"], answer: 1 },
  { q: "Who developed the theory of relativity?", choices: ["Newton", "Einstein", "Tesla", "Hawking"], answer: 1 },
];

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("trivia")
    .setDescription("Answer a random trivia question."),
  async execute(interaction: ChatInputCommandInteraction) {
    const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    const labels = ["A", "B", "C", "D"] as const;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      labels.map((label, idx) =>
        new ButtonBuilder()
          .setCustomId(`trivia:${idx}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Primary),
      ),
    );

    const body =
      `**${question.q}**\n\n` +
      question.choices.map((c, i) => `**${labels[i]}.** ${c}`).join("\n");

    const reply = await interaction.reply({
      content: body,
      components: [row],
      withResponse: true,
    });

    const message = reply.resource?.message;
    if (!message) return;

    try {
      const click = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 30_000,
        filter: (i) => i.user.id === interaction.user.id,
      });
      const picked = Number(click.customId.split(":")[1]) as 0 | 1 | 2 | 3;
      const correct = picked === question.answer;
      const verdict = correct
        ? `${EMOJI_SUCCESS} Correct! The answer is **${labels[question.answer]}. ${question.choices[question.answer]}**.`
        : `${EMOJI_ERROR} Wrong. The answer was **${labels[question.answer]}. ${question.choices[question.answer]}**.`;
      await click.update({ content: `${body}\n\n${verdict}`, components: [] });
    } catch {
      await interaction
        .editReply({
          content: `${body}\n\n⌛ Time's up. The answer was **${labels[question.answer]}. ${question.choices[question.answer]}**.`,
          components: [],
        })
        .catch(() => {});
    }
  },
};

export default command;
