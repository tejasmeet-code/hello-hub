import { SlashCommandBuilder, type ChatInputCommandInteraction, ChannelType, PermissionFlagsBits, EmbedBuilder } from "discord.js";
import type { SlashCommand } from "../types";
import { getOpenTicketByChannel, getTicketsConfig } from "../storage/tickets";
import { getTicketByChannel } from "../storage/shopTickets";
import { getShopSettings } from "../storage/shop";
import { CE } from "../utils/embedStyle";
import { logger } from "../../lib/logger";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("private-ticket")
    .setDescription("Make this ticket visible to admins only.")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId || !interaction.channelId) return;

    await interaction.deferReply({ flags: 1 << 6 });

    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    const channel = interaction.channel;

    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.editReply({ content: `${CE.error.str} This command can only be used in a server text channel.` });
      return;
    }

    const supportTicket = await getOpenTicketByChannel(guildId, channelId);
    const shopTicket = await getTicketByChannel(channelId);

    if (!supportTicket && !shopTicket) {
      await interaction.editReply({ content: `${CE.error.str} This channel is not an active ticket.` });
      return;
    }

    const member = interaction.member;
    const hasAdminPerm = (member?.permissions as any)?.has?.(PermissionFlagsBits.Administrator) ?? false;

    // Determine admin roles for ticket/shop
    const adminRoleIds: string[] = [];
    const supportRoleIdList: string[] = [];
    if (supportTicket) {
      const tc = await getTicketsConfig(guildId);
      if (tc.adminRoleId) adminRoleIds.push(tc.adminRoleId);
      if (tc.supportRoleId) supportRoleIdList.push(tc.supportRoleId);
    }
    if (shopTicket) {
      const ss = await getShopSettings(guildId);
      adminRoleIds.push(...ss.adminRoleIds);
      supportRoleIdList.push(...ss.modRoleIds);
    }

    const hasAdminRole = adminRoleIds.some((roleId) => (member?.roles as any)?.cache?.has(roleId));

    if (!hasAdminPerm && !hasAdminRole) {
      await interaction.editReply({ content: `${CE.error.str} Only administrators can make a ticket private.` });
      return;
    }

    try {
      const botMe = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
      const textChannel = channel as import("discord.js").TextChannel;

      // Ensure @everyone cannot view channel
      await textChannel.permissionOverwrites.edit(guildId, {
        ViewChannel: false,
      }).catch(() => {});

      // Deny ViewChannel for ticket creator so only admins can see it
      const creatorId = supportTicket?.userId || shopTicket?.userId;
      if (creatorId) {
        await textChannel.permissionOverwrites.edit(creatorId, {
          ViewChannel: false,
        }).catch(() => {});
      }

      // Deny non-admin support staff roles
      for (const roleId of supportRoleIdList) {
        if (!adminRoleIds.includes(roleId)) {
          await textChannel.permissionOverwrites.edit(roleId, {
            ViewChannel: false,
          }).catch(() => {});
        }
      }

      // Allow admin roles
      for (const roleId of adminRoleIds) {
        await textChannel.permissionOverwrites.edit(roleId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => {});
      }

      // Ensure bot stays allowed
      if (botMe) {
        await textChannel.permissionOverwrites.edit(botMe.id, {
          ViewChannel: true,
          SendMessages: true,
          ManageChannels: true,
          ReadMessageHistory: true,
        }).catch(() => {});
      }

      const embed = new EmbedBuilder()
        .setTitle(`${CE.locked.str} Private Ticket`)
        .setDescription(`${CE.ticket.str} This ticket is now private and visible exclusively to administrators.`)
        .setColor(0x2b2d31);

      await interaction.editReply({ content: `${CE.success.str} Ticket visibility updated successfully.` });
      await textChannel.send({ embeds: [embed] });
    } catch (err) {
      logger.error({ err, guildId, channelId }, "Failed to make ticket private");
      await interaction.editReply({ content: `${CE.error.str} Failed to update ticket permissions. Please check bot permissions.` });
    }
  },
};

export default command;
