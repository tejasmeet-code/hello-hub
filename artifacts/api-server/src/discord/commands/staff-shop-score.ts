import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { isAdminOrOwner } from "../utils/staffPerms";
import {
  getStaffShopStats,
  removeStaffSale,
  updateStaffSale,
  avgRating,
} from "../storage/shopStats";
import { CE, COLORS, prettyEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-shop-score")
    .setDescription("View or edit a staff member's shop sales record.")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View a staff member's shop score and sales history.")
        .addUserOption((o) => o.setName("staff").setDescription("Staff member").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit a sale record for a staff member (admin only).")
        .addUserOption((o) => o.setName("staff").setDescription("Staff member").setRequired(true))
        .addStringOption((o) => o.setName("ticket_id").setDescription("Ticket ID of the sale to edit").setRequired(true))
        .addStringOption((o) => o.setName("item").setDescription("New item name (leave blank to keep)").setRequired(false))
        .addStringOption((o) => o.setName("price").setDescription("New price (leave blank to keep)").setRequired(false))
        .addIntegerOption((o) => o.setName("rating").setDescription("Override rating (1-10, 0 to remove)").setMinValue(0).setMaxValue(10).setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a sale record from a staff member's history (admin only).")
        .addUserOption((o) => o.setName("staff").setDescription("Staff member").setRequired(true))
        .addStringOption((o) => o.setName("ticket_id").setDescription("Ticket ID to remove").setRequired(true)),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId) return;

    const isAdmin = PERM_WHITELIST.has(interaction.user.id) || await isAdminOrOwner(interaction);
    const sub = interaction.options.getSubcommand();

    if ((sub === "edit" || sub === "delete") && !isAdmin) {
      await interaction.reply({ content: `${CE.error.str} Admin permissions required.`, flags: 1 << 6 });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    const staffUser = interaction.options.getUser("staff", true);
    const stats = await getStaffShopStats(interaction.guildId, staffUser.id);

    if (sub === "view") {
      const avg = avgRating(stats);
      const salesLines = stats.sales.slice(-10).reverse().map((s, i) =>
        `**${i + 1}.** ${s.item} @ ${s.price}${s.rating != null ? ` ${CE.star_rating.str}${s.rating}/10` : ""} — <t:${Math.floor(s.date / 1000)}:d> (Ticket: \`${s.ticketId}\`)`,
      );

      const embed = prettyEmbed({
        title: `${CE.cash.str} Shop Score — ${staffUser.tag}`,
        color: COLORS.primary,
        fields: [
          { name: "Total Sales", value: `**${stats.sales.length}**`, inline: true },
          { name: "Avg Rating", value: avg != null ? `${CE.star_rating.str} **${avg.toFixed(1)}/10**` : "*No ratings yet*", inline: true },
          { name: "Last 10 Sales", value: salesLines.length > 0 ? salesLines.join("\n") : "*No sales recorded*", inline: false },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === "edit") {
      const ticketId = interaction.options.getString("ticket_id", true);
      const item = interaction.options.getString("item");
      const price = interaction.options.getString("price");
      const rating = interaction.options.getInteger("rating");

      const patch: Record<string, any> = {};
      if (item) patch.item = item;
      if (price) patch.price = price;
      if (rating != null) patch.rating = rating === 0 ? undefined : rating;

      const updated = await updateStaffSale(interaction.guildId, staffUser.id, ticketId, patch);
      if (!updated) {
        await interaction.editReply(`${CE.error.str} Sale record \`${ticketId}\` not found for that staff member.`);
        return;
      }
      await interaction.editReply(`${CE.success.str} Updated sale record \`${ticketId}\` for **${staffUser.tag}**.`);
      return;
    }

    if (sub === "delete") {
      const ticketId = interaction.options.getString("ticket_id", true);
      const updated = await removeStaffSale(interaction.guildId, staffUser.id, ticketId);
      if (!updated) {
        await interaction.editReply(`${CE.error.str} Sale record \`${ticketId}\` not found for that staff member.`);
        return;
      }
      await interaction.editReply(`${CE.success.str} Removed sale record \`${ticketId}\` from **${staffUser.tag}**'s history.`);
      return;
    }
  },
};

export default command;