import type { ChatInputCommandInteraction } from "discord.js";
import { logger } from "../../lib/logger";

const WEBHOOK_ENV = "DISCORD_WEBHOOK_URL_1";

interface WebhookEmbed {
  title: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  timestamp: string;
}

function buildEmbed(
  interaction: ChatInputCommandInteraction,
): WebhookEmbed {
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);
  const fullCommand = [
    interaction.commandName,
    subcommandGroup,
    subcommand,
  ]
    .filter(Boolean)
    .join(" ");

  const guild = interaction.guild;
  const channel = interaction.channel;
  const channelLabel =
    channel && "name" in channel && channel.name
      ? `#${channel.name} (${channel.id})`
      : interaction.channelId ?? "unknown";

  return {
    title: `/${fullCommand}`,
    color: 0x5865f2,
    fields: [
      {
        name: "User",
        value: `${interaction.user.tag} (${interaction.user.id})`,
        inline: false,
      },
      {
        name: "Server",
        value: guild ? `${guild.name} (${guild.id})` : "DM",
        inline: false,
      },
      {
        name: "Channel",
        value: channelLabel,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

export async function logCommandToWebhook(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const url = process.env[WEBHOOK_ENV];
  if (!url) return;

  const embed = buildEmbed(interaction);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, command: interaction.commandName },
        "Command webhook returned non-OK status",
      );
    }
  } catch (err) {
    logger.warn(
      { err, command: interaction.commandName },
      "Failed to post command log to webhook",
    );
  }
}
