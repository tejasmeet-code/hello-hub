import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { listStaffRoles } from "../storage/staff";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-roles")
    .setDescription("List the staff roles registered for this server.")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Run this in a server.",
        ephemeral: true,
      });
      return;
    }
    const roles = await listStaffRoles(interaction.guildId);
    if (roles.length === 0) {
      await interaction.reply({
        content:
          "No staff roles have been registered yet. Use `/staff-role-add` to add one.",
        ephemeral: true,
      });
      return;
    }
    const lines = roles.map((r) => `**${r.position}.** <@&${r.roleId}>`);
    const embed = new EmbedBuilder()
      .setTitle("Staff Roles")
      .setColor(0x5865f2)
      .setDescription(lines.join("\n"))
      .setFooter({ text: `${roles.length} role${roles.length === 1 ? "" : "s"}` });
    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
