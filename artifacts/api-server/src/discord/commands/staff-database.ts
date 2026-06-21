import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { listStaffRoles } from "../storage/staff";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-database")
    .setDescription(
      "Show every staff role and the people who currently hold it.",
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", ephemeral: true });
      return;
    }
    await interaction.deferReply();

    const roles = await listStaffRoles(interaction.guildId);
    if (roles.length === 0) {
      await interaction.editReply(
        "No staff roles have been registered yet. Use `/staff-role-add` to add one.",
      );
      return;
    }

    const guild = interaction.guild;
    const members = await guild.members.fetch().catch(() => null);
    if (!members) {
      await interaction.editReply(
        "Couldn't fetch the member list. Make sure the **Server Members Intent** is enabled.",
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Staff Database — ${guild.name}`)
      .setColor(0x5865f2)
      .setTimestamp(new Date());

    let totalStaff = 0;
    for (const r of roles) {
      const holders = members.filter(
        (m) => !m.user.bot && m.roles.cache.has(r.roleId),
      );
      totalStaff += holders.size;
      const lines = [...holders.values()]
        .slice(0, 25)
        .map((m) => `• <@${m.id}>`);
      const value =
        lines.length === 0
          ? "*nobody*"
          : lines.join("\n") + (holders.size > 25 ? `\n…and ${holders.size - 25} more` : "");
      embed.addFields({
        name: `#${r.position} — <@&${r.roleId}> (${holders.size})`,
        value,
        inline: false,
      });
    }
    embed.setFooter({
      text: `${totalStaff} staff member${totalStaff === 1 ? "" : "s"} across ${roles.length} role${roles.length === 1 ? "" : "s"}`,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
