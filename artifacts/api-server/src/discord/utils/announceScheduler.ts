import type { Client } from "discord.js";
import { ChannelType } from "discord.js";
import { logger } from "../../lib/logger";
import { getPendingAcrossAllGuilds, deleteScheduledAnnounce } from "../storage/scheduled-announces";
import { prettyEmbed } from "./embedStyle";

const TICK_MS = 60_000; // check every 60 seconds

export function startAnnounceScheduler(client: Client): void {
  setInterval(() => void tick(client), TICK_MS);
  logger.info("Announce scheduler started (60s tick)");
}

async function tick(client: Client): Promise<void> {
  const due = await getPendingAcrossAllGuilds();
  if (due.length === 0) return;

  for (const entry of due) {
    try {
      const guild = client.guilds.cache.get(entry.guildId);
      if (!guild) {
        await deleteScheduledAnnounce(entry.guildId, entry.id);
        continue;
      }

      const channel = guild.channels.cache.get(entry.channelId)
        ?? await guild.channels.fetch(entry.channelId).catch(() => null);

      if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
        await deleteScheduledAnnounce(entry.guildId, entry.id);
        logger.warn({ guildId: entry.guildId, channelId: entry.channelId }, "Scheduled announce: channel not found or not text");
        continue;
      }

      await channel.send({
        content: entry.pingEveryone ? "@everyone" : undefined,
        embeds: [prettyEmbed({
          title: entry.title,
          description: entry.message,
          color: entry.color,
          footer: `Scheduled by ${entry.createdByTag} • Relosta Bot`,
        })],
      });

      await deleteScheduledAnnounce(entry.guildId, entry.id);
      logger.info({ guildId: entry.guildId, id: entry.id }, "Scheduled announce sent");
    } catch (err) {
      logger.error({ err, id: entry.id }, "Failed to send scheduled announce");
      await deleteScheduledAnnounce(entry.guildId, entry.id);
    }
  }
}