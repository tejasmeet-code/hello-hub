import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getTicketByChannel, updateTicket } from "../storage/shopTickets";
import { getShopSettings } from "../storage/shop";
import { listStaffRoles } from "../storage/staff";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("adduser")
    .setDescription("Add a user to this shop ticket channel.")
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName("user").setDescription("The user to add to this ticket.").setRequired(true),
    ) as any,

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
      await interaction.reply({ content: `${CE.error.str} Only shop staff can add users to tickets.`, flags: 1 << 6 });
      return;
    }

    const target = interaction.options.getUser("user", true);

    if (target.id === ticket.userId) {
      await interaction.reply({ content: `${CE.error.str} The ticket opener already has access.`, flags: 1 << 6 });
      return;
    }
    if (ticket.allowedViewers?.includes(target.id)) {
      await interaction.reply({ content: `${CE.error.str} <@${target.id}> already has access to this ticket.`, flags: 1 << 6 });
      return;
    }

    await interaction.deferReply();

    const channel = interaction.channel as TextChannel;
    try {
      await channel.permissionOverwrites.edit(target.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    } catch {
      await interaction.editReply(`${CE.error.str} Failed to update channel permissions. Check my role hierarchy.`);
      return;
    }

    // Persist to ticket
    await updateTicket(interaction.channelId, (t) => ({
      ...t,
      allowedViewers: [...(t.allowedViewers ?? []), target.id],
    }));

    await interaction.editReply(
      `${CE.success.str} <@${target.id}> has been added to this ticket.`,
    );
  },
};

export default command;
