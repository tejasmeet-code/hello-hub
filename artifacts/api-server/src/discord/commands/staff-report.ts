import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { isManager } from "../utils/staffPerms";
import { logger } from "../../lib/logger";
import { buildStaffReportEmbed } from "../utils/staffReportBuilder";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-report")
    .setDescription(
      "Tier list of staff by promotions, demotions, punishments, and quota completion (admin/manager only).",
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server." , flags: 1 << 6 });
      return;
    }
    if (!(await isManager(interaction))) {
      await interaction.reply({
        content: "You aren't allowed to run staff reports.",
        flags: 1 << 6,
      });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    try {
      const result = await buildStaffReportEmbed(
        interaction.client,
        interaction.guildId,
      );
      if (!result.ok) {
        await interaction.editReply(
          result.reason === "no-roles"
            ? "No staff roles configured yet. Run `/staff-role-add` first."
            : "Couldn't load this server.",
        );
        return;
      }
      await interaction.editReply({
        embeds: [result.embed],
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      logger.error(
        { err, guildId: interaction.guildId },
        "staff-report failed",
      );
      try {
        await interaction.editReply(
          `${CE.error.str} Couldn't build the staff report. The server log has the details.`,
        );
      } catch {
        /* nothing left to do */
      }
    }
  },
};

export default command;