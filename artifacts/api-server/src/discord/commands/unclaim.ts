import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
    .setName("unclaim")
    .setDescription("Unclaim this shop ticket so another staff member can take it.")
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
    if (!ticket.claimedBy) {
      await interaction.reply({ content: `${CE.error.str} This ticket hasn't been claimed yet.`, flags: 1 << 6 });
      return;
    }

    const ss = await getShopSettings(interaction.guildId);
    const guildStaffRoles = await listStaffRoles(interaction.guildId);
    const allModRoleIds = [...new Set([...ss.modRoleIds, ...guildStaffRoles.map((r) => r.roleId)])];
    const member = interaction.member;

    const isAdmin = ss.adminRoleIds.some((r) => (member?.roles as any)?.cache?.has(r));
    const isClaimer = ticket.claimedBy === interaction.user.id;
    const isStaff = allModRoleIds.some((r) => (member?.roles as any)?.cache?.has(r));

    if (!isClaimer && !isAdmin) {
      await interaction.reply({
        content: `${CE.error.str} Only the person who claimed this ticket (or an admin) can unclaim it.`,
        flags: 1 << 6,
      });
      return;
    }

    await interaction.deferReply();

    // Restore visibility to all mod/staff roles
    const channel = interaction.channel as TextChannel;
    try {
      const overwrites: any[] = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: ticket.userId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        ...ss.adminRoleIds.map((r) => ({
          id: r,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ] as bigint[],
        })),
        ...allModRoleIds.map((r) => ({
          id: r,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ] as bigint[],
        })),
      ];

      // Re-add allowedViewers
      for (const uid of ticket.allowedViewers ?? []) {
        overwrites.push({
          id: uid,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ] as bigint[],
        });
      }

      await channel.permissionOverwrites.set(overwrites);
    } catch {
      // non-fatal: proceed even if permission edit fails
    }

    // Update ticket state
    await updateTicket(interaction.channelId, (t) => ({
      ...t,
      claimedBy: undefined,
      status: "open",
    }));

    // Update the pinned control row to show Claim button again
    try {
      const messages = await channel.messages.fetch({ limit: 20 });
      const controlMsg = messages.find(
        (m) =>
          m.author.id === interaction.client.user?.id &&
          m.components.length > 0,
      );
      if (controlMsg) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`shop:claim:${interaction.guildId}:${ticket.ticketId}`)
            .setLabel("Claim Ticket")
            .setStyle(ButtonStyle.Primary)
            .setEmoji(CE.shoppingcart.str),
          new ButtonBuilder()
            .setCustomId(`shop:precl:${interaction.guildId}:${ticket.ticketId}`)
            .setLabel("Close Ticket")
            .setStyle(ButtonStyle.Danger)
            .setEmoji(CE.cash.str),
        );
        await controlMsg.edit({ components: [row] }).catch(() => {});
      }
    } catch { /* non-fatal */ }

    const prevClaimer = ticket.claimedBy;
    await interaction.editReply(
      `${CE.success.str} <@${prevClaimer}> has unclaimed this ticket. It is now open for any staff to claim.`,
    );
  },
};

export default command;
