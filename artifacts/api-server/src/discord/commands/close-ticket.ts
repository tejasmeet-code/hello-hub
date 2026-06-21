import { SlashCommandBuilder, type ChatInputCommandInteraction, ChannelType } from "discord.js";
import type { SlashCommand } from "../types";
import { getTicketByChannel } from "../storage/shopTickets";
import { getShopSettings } from "../storage/shop";
import { listStaffRoles } from "../storage/staff";
import { handleShopInteraction } from "../handlers/shopHandler";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("close-ticket")
    .setDescription("Close a shop ticket in this channel.")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId || !interaction.channelId) return;

    const ticket = await getTicketByChannel(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: `${CE.error.str} This channel is not an active shop ticket.`, flags: 1 << 6 });
      return;
    }
    if (ticket.status === "closed") {
      await interaction.reply({ content: `${CE.error.str} This ticket is already closed.`, flags: 1 << 6 });
      return;
    }

    const ss = await getShopSettings(interaction.guildId);
    const guildStaffRoles = await listStaffRoles(interaction.guildId);
    const allModRoleIds = [...new Set([...ss.modRoleIds, ...guildStaffRoles.map((r) => r.roleId)])];
    const member = interaction.member;
    const isStaff = allModRoleIds.some((r) => (member?.roles as any)?.cache?.has(r))
      || ss.adminRoleIds.some((r) => (member?.roles as any)?.cache?.has(r));
    const isClaimer = ticket.claimedBy === interaction.user.id;

    if (!isStaff && !isClaimer) {
      await interaction.reply({ content: `${CE.error.str} Only shop staff can close tickets.`, flags: 1 << 6 });
      return;
    }

    // Synthesise a fake interaction to re-use the precl flow
    await interaction.reply({
      content: `${CE.loading.str} Select the ticket outcome:`,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: "Service Successful", custom_id: `shop:outcome:s:${interaction.guildId}:${ticket.ticketId}`, emoji: { id: CE.success.id, name: CE.success.name } },
            { type: 2, style: 4, label: "Unsuccessful", custom_id: `shop:outcome:f:${interaction.guildId}:${ticket.ticketId}`, emoji: { id: CE.error.id, name: CE.error.name } },
          ],
        },
      ],
    } as any);
  },
};

export default command;