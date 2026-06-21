import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("say")
    .setDescription("Make the bot repeat a message.")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("What should I say?")
        .setRequired(true)
        .setMaxLength(2000),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "say"))) return;
    const message = interaction.options.getString("message", true);
    await interaction.reply({
      content: "Sent.",
      ephemeral: true,
    });
    const channel = interaction.channel;
    if (channel && channel.isSendable()) {
      await channel.send(message);
    }
  },
};

export default command;
