import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getLeaderboard, getTotalMembersWithXp, getLevelConfig } from "../storage/levels";
import { CE } from "../utils/embedStyle";

const PAGE_SIZE = 10;

const RANK_ICONS = ["🥇", "🥈", "🥉"];

function buildEmbed(
  entries: Array<{ userId: string; data: { level: number; totalXp: number } }>,
  page: number,
  totalPages: number,
  guildName: string,
  color: number,
): EmbedBuilder {
  const start = (page - 1) * PAGE_SIZE;
  const lines = entries.map((e, i) => {
    const pos = start + i + 1;
    const icon = pos <= 3 ? RANK_ICONS[pos - 1]! : `**${pos}.**`;
    return `${icon} <@${e.userId}> — Lvl **${e.data.level}** · ${e.data.totalXp.toLocaleString()} XP`;
  });

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${CE.trophy.str} Leaderboard — ${guildName}`)
    .setDescription(lines.length > 0 ? lines.join("\n") : "*No members have earned XP yet.*")
    .setFooter({ text: `Page ${page}/${totalPages}` })
    .setTimestamp();
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the top members by XP in this server.")
    .addIntegerOption((o) =>
      o.setName("page").setDescription("Page number").setMinValue(1).setRequired(false),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const lc = await getLevelConfig(interaction.guildId);
    if (!lc.enabled) {
      await interaction.editReply({ content: `${CE.error.str} The leveling system is not enabled in this server.` });
      return;
    }

    const total = await getTotalMembersWithXp(interaction.guildId);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    let page = Math.min(totalPages, Math.max(1, interaction.options.getInteger("page") ?? 1));

    const fetchPage = async (p: number) =>
      getLeaderboard(interaction.guildId!, PAGE_SIZE, (p - 1) * PAGE_SIZE);

    let entries = await fetchPage(page);

    const navRow = () =>
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("lb:prev")
          .setLabel("← Prev")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 1),
        new ButtonBuilder()
          .setCustomId("lb:next")
          .setLabel("Next →")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages),
      );

    const reply = await interaction.editReply({
      embeds: [buildEmbed(entries, page, totalPages, interaction.guild.name, lc.embedColor)],
      components: totalPages > 1 ? [navRow()] : [],
    });

    if (totalPages <= 1) return;

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (b) => b.user.id === interaction.user.id && ["lb:prev", "lb:next"].includes(b.customId),
      time: 120_000,
    });

    collector.on("collect", async (btn) => {
      if (btn.customId === "lb:prev") page = Math.max(1, page - 1);
      else page = Math.min(totalPages, page + 1);
      entries = await fetchPage(page);
      await btn.update({
        embeds: [buildEmbed(entries, page, totalPages, interaction.guild!.name, lc.embedColor)],
        components: [navRow()],
      });
    });

    collector.on("end", () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
