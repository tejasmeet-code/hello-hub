import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("roleinfo")
    .setDescription("Get information about a role.")
    .addRoleOption(o => o.setName("role").setDescription("Role to inspect").setRequired(true))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "roleinfo"))) return;
    if (!interaction.guild) return;

    const role = interaction.options.getRole("role", true);
    const memberCount = interaction.guild.members.cache.filter(m => m.roles.cache.has(role.id)).size;
    const colorHex = role.color > 0 ? `#${role.color.toString(16).padStart(6, "0").toUpperCase()}` : "None";
    const createdTs = "createdTimestamp" in role ? (role as any).createdTimestamp as number : parseInt(((BigInt(role.id) >> 22n) + 1420070400000n).toString());
    const created = Math.floor(createdTs / 1000);

    await interaction.reply({
      embeds: [prettyEmbed({
        title: `@${role.name}`,
        description: buildBullets([
          { label: "ID",          value: `\`${role.id}\`` },
          { label: "Color",       value: colorHex },
          { label: "Members",     value: `**${memberCount}**` },
          { label: "Position",    value: `#${role.position}` },
          { label: "Hoisted",     value: role.hoist ? `${CE.success.str} Yes` : `${CE.error.str} No` },
          { label: "Mentionable", value: role.mentionable ? `${CE.success.str} Yes` : `${CE.error.str} No` },
          { label: "Managed",     value: role.managed ? "Yes (bot/integration)" : "No" },
          { label: "Created",     value: `<t:${created}:D>` },
        ]),
        color: role.color > 0 ? role.color : COLORS.neutral,
        footer: `Role ID: ${role.id}`,
      })],
      flags: 1 << 6,
    });
  },
};

export default command;