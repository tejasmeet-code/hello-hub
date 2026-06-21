import type { Client } from "discord.js";
import { logger } from "../../lib/logger";
import { getAllPendingAppeals, updateAppealStatus } from "../storage/appeals";
import { getGuildConfig, getAppealsConfig } from "../storage/config";
import { prettyEmbed, COLORS, CE } from "./embedStyle";

const TICK_MS = 60 * 60 * 1000; // check every hour

export function startAppealAutoCloseScheduler(client: Client): void {
  setInterval(() => void tick(client), TICK_MS);
  logger.info("Appeal auto-close scheduler started (1h tick)");
}

async function tick(client: Client): Promise<void> {
  const pending = await getAllPendingAppeals();
  if (pending.length === 0) return;

  const now = Date.now();

  // Group appeals by guild so we load each guild's config only once
  const byGuild = new Map<string, typeof pending>();
  for (const appeal of pending) {
    const list = byGuild.get(appeal.guild_id) ?? [];
    list.push(appeal);
    byGuild.set(appeal.guild_id, list);
  }

  for (const [guildId, appeals] of byGuild) {
    try {
      const cfg = await getGuildConfig(guildId);
      const { autoCloseDays } = getAppealsConfig(cfg);
      if (autoCloseDays === 0) continue; // auto-close disabled for this guild

      const cutoffMs = autoCloseDays * 24 * 60 * 60 * 1000;
      const guildName = client.guilds.cache.get(guildId)?.name ?? guildId;

      for (const appeal of appeals) {
        const createdAt = new Date(appeal.created_at).getTime();
        if (now - createdAt < cutoffMs) continue; // not old enough yet

        await updateAppealStatus(appeal.id, "rejected", "Relosta Bot (auto-closed)");

        client.users.fetch(appeal.user_id).then(user =>
          user.send({
            embeds: [prettyEmbed({
              title: "Your Appeal Was Auto-Closed",
              description: `${CE.information.str}\n\nYour appeal for **Case #${appeal.case_number}** ` +
                `(${appeal.punishment_type}) in **${guildName}** was automatically closed after ` +
                `**${autoCloseDays} day${autoCloseDays !== 1 ? "s" : ""}** of inactivity.\n\n` +
                `The original punishment remains in place. Contact server staff if you believe this is in error.`,
              color: COLORS.neutral,
              footer: "Relosta Bot",
            })],
          })
        ).catch(() => {});

        logger.info({ guildId, appealId: appeal.id, userId: appeal.user_id, autoCloseDays }, "Appeal auto-closed");
      }
    } catch (err) {
      logger.error({ err, guildId }, "Appeal auto-close scheduler tick error");
    }
  }
}