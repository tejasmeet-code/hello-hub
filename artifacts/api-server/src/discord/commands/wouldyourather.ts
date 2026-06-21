import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

const PROMPTS: [string, string][] = [
  ["have the ability to fly", "be invisible at will"],
  ["live without music", "live without movies"],
  ["always be 10 minutes late", "always be 20 minutes early"],
  ["explore deep space", "explore the deep ocean"],
  ["have unlimited free time", "have unlimited money"],
  ["speak every language fluently", "play every instrument perfectly"],
  ["be famous for a year", "be rich and unknown for life"],
  ["only eat sweet food forever", "only eat savory food forever"],
  ["read minds", "see one minute into the future"],
  ["be able to teleport anywhere", "be able to time travel one day forward or back"],
  ["have a personal robot servant", "have a personal chef"],
  ["live in a treehouse", "live on a houseboat"],
  ["be able to talk to animals", "be able to talk to plants"],
  ["always know when someone is lying", "always get away with lying"],
  ["never feel pain again", "never feel cold again"],
];

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("wouldyourather")
    .setDescription("Get a random Would You Rather prompt."),
  async execute(interaction: ChatInputCommandInteraction) {
    const [a, b] = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("wyr:a")
        .setLabel("A")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("wyr:b")
        .setLabel("B")
        .setStyle(ButtonStyle.Primary),
    );

    const body = `${CE.thinking.str} **Would you rather…**\n**A.** ${a}\n**B.** ${b}`;
    const reply = await interaction.reply({
      content: body,
      components: [row],
      withResponse: true,
    });

    const message = reply.resource?.message;
    if (!message) return;

    const counts = { a: 0, b: 0 };
    const voters = new Set<string>();
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
    });

    collector.on("collect", async (i) => {
      if (voters.has(i.user.id)) {
        await i.reply({ content: "You already voted.", ephemeral: true });
        return;
      }
      voters.add(i.user.id);
      if (i.customId === "wyr:a") counts.a += 1;
      else counts.b += 1;
      await i.reply({ content: "Vote recorded.", ephemeral: true });
    });

    collector.on("end", async () => {
      const total = counts.a + counts.b || 1;
      const pa = Math.round((counts.a / total) * 100);
      const pb = 100 - pa;
      await interaction
        .editReply({
          content:
            `${body}\n\n${CE.chart.str} **Results:**\n` +
            `A — ${counts.a} (${pa}%)\nB — ${counts.b} (${pb}%)`,
          components: [],
        })
        .catch(() => {});
    });
  },
};

export default command;
