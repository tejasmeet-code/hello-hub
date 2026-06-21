import {
  ChannelType,
  type Client,
  type GuildTextBasedChannel,
} from "discord.js";
import { logger } from "../../lib/logger";
import {
  clearStaffReportChannel,
  getGuildConfig,
  getStaffReportConfig,
  listGuildsWithStaffReportChannel,
  setStaffReportState,
} from "../storage/config";
import { buildStaffReportEmbed } from "./staffReportBuilder";

/** Minimum check cadence — every hour we evaluate which guilds are due. */
const ONE_HOUR_MS = 60 * 60 * 1000;

export type PostStaffReportResult =
  | {
      ok: true;
      action: "edited" | "posted";
      channelId: string;
      messageId: string;
    }
  | {
      ok: false;
      reason:
        | "no-channel-configured"
        | "channel-not-found"
        | "channel-not-text"
        | "no-permissions"
        | "build-failed-no-roles"
        | "build-failed-no-guild";
      detail?: string;
    };

/**
 * Build the staff tier report embed for a guild and either post a fresh
 * message in the configured channel or edit the previously posted one.
 * Persists the message ID and lastUpdated timestamp.
 */
export async function postOrEditStaffReport(
  client: Client,
  guildId: string,
): Promise<PostStaffReportResult> {
  const cfg = await getGuildConfig(guildId);
  const channelId = cfg.channels.staffReport;
  if (!channelId) return { ok: false, reason: "no-channel-configured" };

  const built = await buildStaffReportEmbed(client, guildId);
  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason === "no-roles" ? "build-failed-no-roles" : "build-failed-no-guild",
    };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await clearStaffReportChannel(guildId).catch(() => {});
    return { ok: false, reason: "channel-not-found" };
  }
  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    return { ok: false, reason: "channel-not-text" };
  }
  const textChannel = channel as GuildTextBasedChannel;

  const state = cfg.staffReportState;
  if (state && state.channelId === channelId) {
    try {
      const existing = await textChannel.messages.fetch(state.messageId);
      await existing.edit({ embeds: [built.embed], allowedMentions: { parse: [] } });
      await setStaffReportState(guildId, {
        channelId,
        messageId: state.messageId,
        lastUpdated: Date.now(),
      });
      return { ok: true, action: "edited", channelId, messageId: state.messageId };
    } catch (err) {
      logger.debug(
        { err, guildId, channelId, messageId: state.messageId },
        "staffReport: previous message gone, posting fresh",
      );
    }
  }

  try {
    const sent = await textChannel.send({
      embeds: [built.embed],
      allowedMentions: { parse: [] },
    });
    await setStaffReportState(guildId, {
      channelId,
      messageId: sent.id,
      lastUpdated: Date.now(),
    });
    return { ok: true, action: "posted", channelId, messageId: sent.id };
  } catch (err) {
    logger.warn({ err, guildId, channelId }, "staffReport: send failed");
    return { ok: false, reason: "no-permissions" };
  }
}

/**
 * Run the staff report refresh for every guild that is due for a refresh
 * based on its configured interval. Failures on one guild don't block others.
 */
export async function refreshAllStaffReports(client: Client): Promise<void> {
  const targets = await listGuildsWithStaffReportChannel();
  if (targets.length === 0) return;

  const now = Date.now();
  logger.info({ guilds: targets.length }, "staffReport: evaluating auto-refresh");

  for (const { guildId } of targets) {
    try {
      const cfg = await getGuildConfig(guildId);
      const { refreshIntervalHours } = getStaffReportConfig(cfg);
      const intervalMs = refreshIntervalHours * ONE_HOUR_MS;
      const lastUpdated = cfg.staffReportState?.lastUpdated ?? 0;

      if (now - lastUpdated < intervalMs) {
        logger.debug(
          { guildId, refreshIntervalHours, msSinceLast: now - lastUpdated },
          "staffReport: guild not due yet, skipping",
        );
        continue;
      }

      const result = await postOrEditStaffReport(client, guildId);
      if (!result.ok) {
        logger.warn({ guildId, reason: result.reason }, "staffReport: refresh failed for guild");
      } else {
        logger.info({ guildId, action: result.action }, "staffReport: refreshed");
      }
    } catch (err) {
      logger.warn({ err, guildId }, "staffReport: refresh threw for guild");
    }
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Start the hourly auto-refresh loop. Idempotent — calling twice does nothing.
 * Each guild's configured interval is respected; the 1h tick is just the
 * minimum granularity check.
 */
export function startStaffReportAutoUpdate(client: Client): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    refreshAllStaffReports(client).catch((err) =>
      logger.warn({ err }, "staffReport: auto-update interval threw"),
    );
  }, ONE_HOUR_MS);
  if (intervalHandle.unref) intervalHandle.unref();
  logger.info(
    { checkIntervalHours: 1 },
    "staffReport: auto-update scheduler started (1h check, per-guild interval applied)",
  );
}