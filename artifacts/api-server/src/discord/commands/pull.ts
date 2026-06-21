import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ChannelType,
  type TextChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { getPullableMembers, removePullableMember } from "../storage/pullable-members";
import { logger } from "../../lib/logger";
import { CE } from "../utils/embedStyle";

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function addMemberToGuild(
  guildId: string,
  userId: string,
  botToken: string,
  accessToken?: string,
): Promise<{ success: boolean; method: "direct" | "invite" | "none"; inviteUrl?: string; guild?: any }> {
  // If we have a user access token with guilds.join scope, add directly
  if (accessToken) {
    try {
      const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/members/${userId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: accessToken }),
      });
      if (res.status === 201 || res.status === 204) {
        return { success: true, method: "direct" };
      }
      const err = await res.json().catch(() => ({}));
      logger.warn({ userId, guildId, status: res.status, err }, "Direct guild add failed, falling back to invite");
    } catch (err) {
      logger.warn({ err, userId, guildId }, "Direct guild add threw, falling back to invite");
    }
  }

  return { success: false, method: "none" };
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("pull")
    .setDescription("Pull verified members to a server (global whitelist only)")
    .addStringOption((option) =>
      option
        .setName("server-id")
        .setDescription("The server ID to pull members to")
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setDescription("Number of members to pull (leave empty for all)")
        .setRequired(false)
        .setMinValue(1),
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "You aren't allowed to use this command.",
        flags: 1 << 6,
      });
      return;
    }

    const serverId = interaction.options.getString("server-id", true);
    const count = interaction.options.getInteger("count");

    if (!/^\d+$/.test(serverId)) {
      await interaction.reply({
        content: "Invalid server ID format.",
        flags: 1 << 6,
      });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    let targetGuild;
    try {
      targetGuild = await interaction.client.guilds.fetch(serverId);
    } catch {
      await interaction.editReply(
        `${CE.error.str} Could not access server **${serverId}**. Make sure the bot is in that server.`,
      );
      return;
    }

    const pullableMembers = await getPullableMembers();
    if (pullableMembers.length === 0) {
      await interaction.editReply(`${CE.information.str} No verified members available to pull.`);
      return;
    }

    const botToken = process.env.DISCORD_BOT_TOKEN!;
    const pullCount = count ? Math.min(count, pullableMembers.length) : pullableMembers.length;
    const membersToPull = pullableMembers.slice(0, pullCount);

    let directCount = 0;
    let inviteCount = 0;
    let failCount = 0;
    const inviteLines: string[] = [];

    // Find a text channel once for invite creation fallback
    let fallbackChannel: TextChannel | null = null;
    try {
      const channels = await targetGuild.channels.fetch();
      fallbackChannel = (channels.find(
        (c): c is TextChannel => !!c && c.type === ChannelType.GuildText,
      ) ?? null) as TextChannel | null;
    } catch {}

    for (const memberData of membersToPull) {
      try {
        // Attempt direct add if access token is stored
        const accessToken = (memberData as any).accessToken as string | undefined;
        const result = await addMemberToGuild(serverId, memberData.userId, botToken, accessToken);

        if (result.success && result.method === "direct") {
          directCount++;
          await removePullableMember(memberData.userId);
          continue;
        }

        // Fall back to invite link + DM
        if (!fallbackChannel) {
          failCount++;
          continue;
        }

        const invite = await fallbackChannel.createInvite({
          maxUses: 1,
          unique: true,
          reason: `Pull invite for verified user ${memberData.username}`,
        });

        inviteLines.push(`• **${memberData.username}**: ${invite.url}`);

        try {
          const user = await interaction.client.users.fetch(memberData.userId);
          await user.send(
            `${CE.success.str} **You've been invited to join a server!**\n\n` +
            `Server: **${targetGuild.name}**\n` +
            `Invite Link: ${invite.url}\n\n` +
            `This invite is exclusive to you and expires after one use.`,
          );
        } catch (dmErr) {
          logger.warn({ dmErr, userId: memberData.userId }, "Failed to DM invite to user");
        }

        await removePullableMember(memberData.userId);
        inviteCount++;
      } catch (err) {
        logger.warn({ err, userId: memberData.userId, serverId }, "Failed to pull member");
        failCount++;
      }
    }

    const total = directCount + inviteCount + failCount;
    let response =
      `${CE.success.str} Pull complete for **${targetGuild.name}**\n` +
      `${CE.information.str} Total attempted: **${total}**\n`;

    if (directCount > 0) {
      response += `${CE.check.str} Directly added: **${directCount}** member${directCount === 1 ? "" : "s"}\n`;
    }
    if (inviteCount > 0) {
      response += `${CE.link.str} Invite links sent: **${inviteCount}** member${inviteCount === 1 ? "" : "s"}\n`;
    }
    if (failCount > 0) {
      response += `${CE.error.str} Failed: **${failCount}** member${failCount === 1 ? "" : "s"}\n`;
    }

    if (directCount === 0 && inviteCount === 0) {
      response += `\n${CE.information.str} No members were pulled. They may need to re-verify with the bot authorized.`;
    }

    if (inviteLines.length > 0) {
      const preview = inviteLines.slice(0, 10).join("\n");
      response += `\n${CE.information.str} **Invite Links Created:**\n${preview}`;
      if (inviteLines.length > 10) {
        response += `\n... and ${inviteLines.length - 10} more`;
      }
    }

    await interaction.editReply(response);
  },
};

export default command;