import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { isAdminOrOwner } from "../utils/staffPerms";
import {
  getCustomerRecord,
  removeCustomerPurchase,
  updateCustomerPurchase,
  setCustomerPoints,
} from "../storage/shopStats";
import { CE, COLORS, prettyEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("customer-points")
    .setDescription("View or manage customer purchase points.")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View a customer's purchase history and points.")
        .addUserOption((o) => o.setName("user").setDescription("Customer").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set a customer's point total (admin only).")
        .addUserOption((o) => o.setName("user").setDescription("Customer").setRequired(true))
        .addIntegerOption((o) => o.setName("points").setDescription("New point total").setMinValue(0).setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit a purchase record (admin only).")
        .addUserOption((o) => o.setName("user").setDescription("Customer").setRequired(true))
        .addStringOption((o) => o.setName("ticket_id").setDescription("Ticket ID").setRequired(true))
        .addStringOption((o) => o.setName("item").setDescription("New item name").setRequired(false))
        .addStringOption((o) => o.setName("price").setDescription("New price").setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Remove a purchase record (admin only).")
        .addUserOption((o) => o.setName("user").setDescription("Customer").setRequired(true))
        .addStringOption((o) => o.setName("ticket_id").setDescription("Ticket ID to remove").setRequired(true)),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId) return;

    const isAdmin = PERM_WHITELIST.has(interaction.user.id) || await isAdminOrOwner(interaction);
    const sub = interaction.options.getSubcommand();

    if (sub !== "view" && !isAdmin) {
      await interaction.reply({ content: `${CE.error.str} Admin permissions required.`, flags: 1 << 6 });
      return;
    }

    await interaction.deferReply();

    const user = interaction.options.getUser("user", true);
    const record = await getCustomerRecord(interaction.guildId, user.id);

    if (sub === "view") {
      const purchaseLines = record.purchases.slice(-10).reverse().map((p, i) =>
        `**${i + 1}.** ${p.item} @ ${p.price} — <t:${Math.floor(p.date / 1000)}:d> (Staff: <@${p.staffId}>)`,
      );
      const embed = prettyEmbed({
        title: `${CE.ltc.str} Customer Points — ${user.tag}`,
        color: COLORS.primary,
        fields: [
          { name: "Total Points", value: `**${record.points}**`, inline: true },
          { name: "Total Purchases", value: `**${record.purchases.length}**`, inline: true },
          { name: "Last 10 Purchases", value: purchaseLines.length > 0 ? purchaseLines.join("\n") : "*No purchases yet*", inline: false },
        ],
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === "set") {
      const points = interaction.options.getInteger("points", true);
      await setCustomerPoints(interaction.guildId, user.id, points);
      await interaction.editReply(`${CE.success.str} Set **${user.tag}**'s points to **${points}**.`);
      return;
    }

    if (sub === "edit") {
      const ticketId = interaction.options.getString("ticket_id", true);
      const patch: Record<string, string> = {};
      const item = interaction.options.getString("item");
      const price = interaction.options.getString("price");
      if (item) patch.item = item;
      if (price) patch.price = price;

      const updated = await updateCustomerPurchase(interaction.guildId, user.id, ticketId, patch);
      if (!updated) {
        await interaction.editReply(`${CE.error.str} Purchase \`${ticketId}\` not found for that user.`);
        return;
      }
      await interaction.editReply(`${CE.success.str} Updated purchase \`${ticketId}\` for **${user.tag}**.`);
      return;
    }

    if (sub === "delete") {
      const ticketId = interaction.options.getString("ticket_id", true);
      const updated = await removeCustomerPurchase(interaction.guildId, user.id, ticketId);
      if (!updated) {
        await interaction.editReply(`${CE.error.str} Purchase \`${ticketId}\` not found for that user.`);
        return;
      }
      await interaction.editReply(`${CE.success.str} Removed purchase \`${ticketId}\` from **${user.tag}**'s history (−1 point).`);
      return;
    }
  },
};

export default command;