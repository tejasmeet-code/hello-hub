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

const LABELS = ["A", "B", "C", "D", "E"] as const;

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a quick poll with up to 5 options.")
    .addStringOption((o) =>
      o
        .setName("question")
        .setDescription("The poll question")
        .setRequired(true)
        .setMaxLength(200),
    )
    .addStringOption((o) =>
      o
        .setName("options")
        .setDescription("Comma-separated options (2-5)")
        .setRequired(true)
        .setMaxLength(500),
    )
    .addIntegerOption((o) =>
      o
        .setName("duration")
        .setDescription("Seconds to keep voting open (default 60, max 600)")
        .setRequired(false)
        .setMinValue(10)
        .setMaxValue(600),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const question = interaction.options.getString("question", true);
    const raw = interaction.options.getString("options", true);
    const duration = (interaction.options.getInteger("duration") ?? 60) * 1000;

    const options = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (options.length < 2 || options.length > 5) {
      await interaction.reply({
        content: "Provide between 2 and 5 comma-separated options.",
        ephemeral: true,
      });
      return;
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      options.map((_, i) =>
        new ButtonBuilder()
          .setCustomId(`poll:${i}`)
          .setLabel(LABELS[i])
          .setStyle(ButtonStyle.Primary),
      ),
    );

    const body = (counts: number[]) => {
      const total = counts.reduce((a, b) => a + b, 0);
      const lines = options.map((opt, i) => {
        const pct = total === 0 ? 0 : Math.round((counts[i] / total) * 100);
        const filled = Math.round(pct / 10);
        const bar = "█".repeat(filled) + "░".repeat(10 - filled);
        return `**${LABELS[i]}.** ${opt}\n\`${bar}\` ${counts[i]} (${pct}%)`;
      });
      return `${CE.information.str} **${question}**\n\n${lines.join("\n")}`;
    };

    const counts = new Array(options.length).fill(0) as number[];
    const voted = new Map<string, number>();

    const reply = await interaction.reply({
      content: body(counts),
      components: [row],
      withResponse: true,
    });

    const message = reply.resource?.message;
    if (!message) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: duration,
    });

    collector.on("collect", async (i) => {
      const idx = Number(i.customId.split(":")[1]);
      const previous = voted.get(i.user.id);
      if (previous === idx) {
        await i.reply({ content: "You already voted for that.", ephemeral: true });
        return;
      }
      if (previous !== undefined) counts[previous] -= 1;
      counts[idx] += 1;
      voted.set(i.user.id, idx);
      await i.update({ content: body(counts), components: [row] });
    });

    collector.on("end", async () => {
      await interaction
        .editReply({
          content: `${body(counts)}\n\n${CE.check.str} Voting closed.`,
          components: [],
        })
        .catch(() => {});
    });
  },
};

export default command;
