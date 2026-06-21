import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { prettyEmbed, buildBullets, COLORS } from "../utils/embedStyle";
import { getCommands } from "../registry";

const START = Date.now();

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("View stats and info about Relosta Bot.")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    const up = Date.now() - START;
    const h = Math.floor(up / 3600000);
    const m = Math.floor((up % 3600000) / 60000);
    const s = Math.floor((up % 60000) / 1000);

    await interaction.reply({
      embeds: [prettyEmbed({
        title: "Relosta Bot",
        description: buildBullets([
          { label: "Guilds",   value: `**${interaction.client.guilds.cache.size}**` },
          { label: "Commands", value: `**${getCommands().length}**` },
          { label: "Uptime",   value: `${h}h ${m}m ${s}s` },
          { label: "Ping",     value: `**${interaction.client.ws.ping}ms** WebSocket` },
          { label: "Library",  value: "discord.js v14" },
          { label: "Runtime",  value: `Node.js ${process.version}` },
        ]),
        thumbnail: interaction.client.user?.displayAvatarURL({ size: 256 }),
        color: COLORS.primary,
        footer: "Relosta Bot • Staff Management System",
      })],
      flags: 1 << 6,
    });
  },
};

export default command;