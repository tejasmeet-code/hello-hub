import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getGuildCommands } from "../registry";
import { COLORS } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("List all available slash commands."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 1 << 6 });

    const commands = getGuildCommands();

    // Split into pages of up to 25 commands each so no embed exceeds limits
    const PAGE_SIZE = 25;
    const pages: EmbedBuilder[] = [];

    for (let i = 0; i < commands.length; i += PAGE_SIZE) {
      const slice = commands.slice(i, i + PAGE_SIZE);
      const page = Math.floor(i / PAGE_SIZE) + 1;
      const totalPages = Math.ceil(commands.length / PAGE_SIZE);

      pages.push(
        new EmbedBuilder()
          .setTitle(`Bot Commands${totalPages > 1 ? ` (Page ${page}/${totalPages})` : ""}`)
          .setColor(COLORS.primary)
          .setDescription(
            slice.map((c) => `**/${c.data.name}** — ${c.data.description}`).join("\n"),
          )
          .setFooter({ text: `${commands.length} commands available` }),
      );
    }

    await interaction.editReply({ embeds: [pages[0]] });

    // Send remaining pages as follow-ups
    for (let i = 1; i < pages.length; i++) {
      await interaction.followUp({ embeds: [pages[i]], flags: 1 << 6 }).catch(() => {});
    }
  },
};

export default command;
