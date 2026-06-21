import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { getPartnerships } from "../storage/partnerships";
import { getProfile } from "../storage/staff";
import { CE, COLORS } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("partnership-score")
    .setDescription("Check partnership scores for a staff member")
    .addUserOption((option) =>
      option
        .setName("staff")
        .setDescription("The staff member to check (defaults to yourself)")
        .setRequired(false),
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: 1 << 6,
      });
      return;
    }

    const targetUser = interaction.options.getUser("staff") ?? interaction.user;
    const staffProfile = await getProfile(interaction.guildId, targetUser.id);

    if (!staffProfile) {
      await interaction.reply({
        content: `${CE.error.str} ${targetUser} is not a staff member.`,
        flags: 1 << 6,
      });
      return;
    }

    const partnerships = await getPartnerships(interaction.guildId);
    const userPartnerships = partnerships.filter(p => p.staffUserId === targetUser.id && p.status === "approved");

    const now = Date.now();

    // Calculate start of this week (Monday)
    const today = new Date(now);
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfThisWeek = new Date(today);
    startOfThisWeek.setDate(today.getDate() - daysSinceMonday);
    startOfThisWeek.setHours(0, 0, 0, 0);
    const thisWeekStart = startOfThisWeek.getTime();

    // Calculate start of last week
    const startOfLastWeek = new Date(startOfThisWeek);
    startOfLastWeek.setDate(startOfThisWeek.getDate() - 7);
    const lastWeekStart = startOfLastWeek.getTime();
    const lastWeekEnd = thisWeekStart - 1;

    const allTime = userPartnerships.length;
    const thisWeek = userPartnerships.filter(p => p.reviewedAt && p.reviewedAt >= thisWeekStart).length;
    const lastWeek = userPartnerships.filter(p => p.reviewedAt && p.reviewedAt >= lastWeekStart && p.reviewedAt <= lastWeekEnd).length;

    const embed = new EmbedBuilder()
      .setTitle(`${CE.link.str} Partnership Score — ${targetUser.displayName}`)
      .setDescription(`Partnerships approved by ${targetUser}`)
      .addFields(
        { name: "All Time", value: `${allTime}`, inline: true },
        { name: "This Week", value: `${thisWeek}`, inline: true },
        { name: "Last Week", value: `${lastWeek}`, inline: true },
      )
      .setColor(COLORS.primary)
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed], flags: 1 << 6 });
  },
};

export default command;