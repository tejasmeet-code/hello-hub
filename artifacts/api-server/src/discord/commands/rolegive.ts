import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("rolegive")
    .setDescription("Give a role to a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to give the role to").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role to give").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(256))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "rolegive"))) return;
    if (!interaction.guild) return;

    const target = interaction.options.getUser("user", true);
    const role = interaction.options.getRole("role", true);
    const reason = interaction.options.getString("reason") ?? `Added by ${interaction.user.tag}`;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({ embeds: [errorEmbed("Not in server", "That user is not in this server.")] , flags: 1 << 6 });
      return;
    }
    if (member.roles.cache.has(role.id)) {
      await interaction.reply({ embeds: [errorEmbed("Already has role", `**${target.tag}** already has <@&${role.id}>.`)] , flags: 1 << 6 });
      return;
    }

    try {
      await member.roles.add(role.id, reason);
    } catch {
      await interaction.reply({ embeds: [errorEmbed("Failed", "Could not add that role — check my permissions and role hierarchy.")] , flags: 1 << 6 });
      return;
    }

    await interaction.reply({
      embeds: [prettyEmbed({
        title: "Role added",
        description: `${CE.success.str}\n\n${buildBullets([
          { label: "User",   value: `<@${target.id}> — ${target.tag}` },
          { label: "Role",   value: `<@&${role.id}>` },
          { label: "Reason", value: reason },
        ])}`,
        thumbnail: target.displayAvatarURL({ size: 256 }),
        color: COLORS.success,
      })],
      flags: 1 << 6,
    });
  },
};

export default command;