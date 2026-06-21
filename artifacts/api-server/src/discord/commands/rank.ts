import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getMemberLevel, getLevelConfig, getLeaderboardRank, getTotalMembersWithXp } from "../storage/levels";
import { xpToNextLevel, totalXpForLevel, progressBar } from "../utils/levelCalc";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("View your level and XP rank in this server.")
    .addUserOption((o) =>
      o.setName("user").setDescription("User to check rank for (defaults to you)").setRequired(false),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const target = interaction.options.getUser("user") ?? interaction.user;
    const lc = await getLevelConfig(interaction.guildId);

    if (!lc.enabled) {
      await interaction.editReply({ content: `${CE.error.str} The leveling system is not enabled in this server.` });
      return;
    }

    const data = await getMemberLevel(interaction.guildId, target.id);
    const level = data.level;
    const totalXp = data.totalXp;
    const xpInLevel = totalXp - totalXpForLevel(level);
    const xpNeeded = xpToNextLevel(level);
    const rank = await getLeaderboardRank(interaction.guildId, target.id);
    const total = await getTotalMembersWithXp(interaction.guildId);
    const rankStr = rank === -1 ? "Unranked" : `#${rank} of ${total}`;

    const limitNote = lc.levelLimit !== null && level >= lc.levelLimit
      ? `\n> ${CE.trophy.str} **Max level reached!**`
      : "";

    const embed = new EmbedBuilder()
      .setColor(lc.embedColor)
      .setAuthor({
        name: target.username,
        iconURL: target.displayAvatarURL(),
      })
      .setTitle(`${CE.level.str} Level ${level}`)
      .setDescription(
        `> **Server Rank:** ${rankStr}` +
        `\n> **Total XP:** ${totalXp.toLocaleString()}` +
        `\n> **Progress:** ${progressBar(xpInLevel, xpNeeded)}` +
        limitNote,
      )
      .setFooter({ text: `${interaction.guild.name} Leveling` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
