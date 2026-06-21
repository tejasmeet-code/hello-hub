import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { getAllStaffStats, avgRating } from "../storage/shopStats";
import { getShopSettings } from "../storage/shop";
import { CE, COLORS, prettyEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("shop-top-staff")
    .setDescription("View the top shop staff ranked by average rating and sales.")
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName("sort")
        .setDescription("Sort by (default: rating)")
        .setRequired(false)
        .addChoices(
          { name: "Average Rating", value: "rating" },
          { name: "Total Sales", value: "sales" },
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId) return;

    const ss = await getShopSettings(interaction.guildId);
    if (!ss.enabled) {
      await interaction.reply({ content: `${CE.error.str} The Shop module is not enabled on this server.`, flags: 1 << 6 });
      return;
    }

    await interaction.deferReply();

    const sort = (interaction.options.getString("sort") ?? "rating") as "rating" | "sales";
    const allStats = await getAllStaffStats(interaction.guildId);

    if (allStats.length === 0) {
      await interaction.editReply({ embeds: [prettyEmbed({ title: `${CE.shoppingcart.str} Shop Top Staff`, description: "No sales recorded yet.", color: COLORS.neutral })] });
      return;
    }

    const ranked = allStats
      .map((s) => ({ ...s, avg: avgRating(s), salesCount: s.sales.length }))
      .filter((s) => s.salesCount > 0)
      .sort((a, b) => {
        if (sort === "sales") return b.salesCount - a.salesCount;
        const aR = a.avg ?? -1;
        const bR = b.avg ?? -1;
        if (bR !== aR) return bR - aR;
        return b.salesCount - a.salesCount;
      })
      .slice(0, 15);

    const medals = [CE.rank1.str, CE.rank2.str, CE.rank3.str];
    const lines = ranked.map((s, i) => {
      const medal = medals[i] ?? `**${i + 1}.**`;
      const avgStr = s.avg != null ? `${CE.star_rating.str} ${s.avg.toFixed(1)}/10` : "No ratings";
      return `${medal} <@${s.staffId}> — ${avgStr} · **${s.salesCount}** sale${s.salesCount === 1 ? "" : "s"}`;
    });

    const embed = prettyEmbed({
      title: `${CE.shoppingcart.str} Shop Top Staff`,
      description: lines.join("\n"),
      color: COLORS.premium,
      footer: `Sorted by ${sort === "rating" ? "Average Rating" : "Total Sales"} · ${ranked.length} staff shown`,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;