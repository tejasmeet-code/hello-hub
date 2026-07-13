import {
  type Client,
  type Guild,
  type TextChannel,
  ChannelType,
  EmbedBuilder,
} from "discord.js";
import { getGuildConfig } from "../storage/config";
import { logger } from "../../lib/logger";

export interface GlobalNotificationPayload {
  mode: "embed" | "text" | "both";
  message: string;
  title?: string;
  textAbove?: string;
  imageUrl?: string;
}

export interface GlobalNotificationResult {
  sentCount: number;
  failCount: number;
  guildsNotified: string[];
}

export async function sendGlobalBotNotification(
  client: Client,
  payload: GlobalNotificationPayload,
): Promise<GlobalNotificationResult> {
  let sentCount = 0;
  let failCount = 0;
  const guildsNotified: string[] = [];

  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = await getGuildConfig(guild.id);
      let targetChannel: TextChannel | null = null;

      if (cfg.channels.botNotifications) {
        const ch =
          guild.channels.cache.get(cfg.channels.botNotifications) ??
          (await guild.channels.fetch(cfg.channels.botNotifications).catch(() => null));
        if (ch && ch.type === ChannelType.GuildText) {
          targetChannel = ch as TextChannel;
        }
      }

      if (!targetChannel && guild.systemChannel && guild.systemChannel.type === ChannelType.GuildText) {
        targetChannel = guild.systemChannel as TextChannel;
      }

      if (!targetChannel) {
        targetChannel = guild.channels.cache.find(
          (c) =>
            c.type === ChannelType.GuildText &&
            guild.members.me?.permissionsIn(c).has(["SendMessages", "ViewChannel"])
        ) as TextChannel | null;
      }

      if (!targetChannel) {
        failCount++;
        continue;
      }

      const msgOpts: any = {};
      if (payload.mode === "text") {
        msgOpts.content = payload.message;
      } else if (payload.mode === "embed") {
        const embed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setDescription(payload.message)
          .setTimestamp();
        if (payload.title) embed.setTitle(payload.title);
        if (payload.imageUrl) embed.setImage(payload.imageUrl);
        msgOpts.embeds = [embed];
      } else if (payload.mode === "both") {
        msgOpts.content = payload.textAbove || payload.message;
        const embed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setDescription(payload.message)
          .setTimestamp();
        if (payload.title) embed.setTitle(payload.title);
        if (payload.imageUrl) embed.setImage(payload.imageUrl);
        msgOpts.embeds = [embed];
      }

      await targetChannel.send(msgOpts);
      sentCount++;
      guildsNotified.push(guild.name);
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "[GlobalNotification] Failed to send to guild");
      failCount++;
    }
  }

  return { sentCount, failCount, guildsNotified };
}
