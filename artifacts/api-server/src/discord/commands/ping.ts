import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's latency."),
  async execute(interaction: ChatInputCommandInteraction) {
    const sent = await interaction.reply({
      content: "Pinging...",
      fetchReply: true,
    });
    const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
    const wsPing = Math.round(interaction.client.ws.ping);
    await interaction.editReply(
      `Pong! Round trip: \`${roundTrip}ms\` • WebSocket: \`${wsPing}ms\``,
    );
  },
};

export default command;
