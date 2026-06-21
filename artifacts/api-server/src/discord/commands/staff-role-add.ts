import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { addStaffRole, removeStaffRole, listStaffRoles } from "../storage/staff";
import { isAdminOrOwner } from "../utils/staffPerms";
import { PERM_WHITELIST } from "../storage/whitelist";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-role-add")
    .setDescription("Register a Discord role as a staff role.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addRoleOption((o) =>
      o.setName("role").setDescription("The role to register").setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("position")
        .setDescription(
          "Hierarchy position (1 = highest). Default = lowest + 1.",
        )
        .setMinValue(1)
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "Run this in a server.",
        ephemeral: true,
      });
      return;
    }
    if (!isAdminOrOwner(interaction) && !PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "Only administrators can add staff roles.",
        ephemeral: true,
      });
      return;
    }
    const role = interaction.options.getRole("role", true);
    const position = interaction.options.getInteger("position", false) ?? undefined;
    const result = await addStaffRole(interaction.guildId, role.id, position);
    if (!result.added) {
      await interaction.reply({
        content: `<@&${role.id}> is already registered at position **${result.entry.position}**.`,
        ephemeral: true,
      });
      return;
    }
    const all = await listStaffRoles(interaction.guildId);
    const lines = all.map(
      (r) => `**${r.position}.** <@&${r.roleId}>${r.roleId === role.id ? " ⬅️ added" : ""}`,
    );
    await interaction.reply(
      `${CE.success.str} Registered <@&${role.id}> at position **${result.entry.position}**.\n\n${lines.join("\n")}`,
    );
  },
};

export const removeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-role-remove")
    .setDescription("Unregister a staff role.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addRoleOption((o) =>
      o.setName("role").setDescription("The role to unregister").setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: "Run this in a server.", ephemeral: true });
      return;
    }
    if (!isAdminOrOwner(interaction) && !PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "Only administrators can remove staff roles.",
        ephemeral: true,
      });
      return;
    }
    const role = interaction.options.getRole("role", true);
    const removed = await removeStaffRole(interaction.guildId, role.id);
    if (!removed) {
      await interaction.reply({
        content: `<@&${role.id}> wasn't registered as a staff role.`,
        ephemeral: true,
      });
      return;
    }
    await interaction.reply(`🗑️ Unregistered <@&${role.id}>.`);
  },
};

export default command;
