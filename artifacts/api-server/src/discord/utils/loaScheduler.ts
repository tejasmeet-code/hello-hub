import type { Client } from "discord.js";
import { ChannelType, type GuildTextBasedChannel } from "discord.js";
import { logger } from "../../lib/logger";
import {
  getAllActiveLOAsAcrossGuilds,
  parseReturnTs,
  markLOAReminderSent,
  autoEndLOAById,
} from "../storage/loa";
import { getGuildConfig } from "../storage/config";
import { prettyEmbed, buildBullets, COLORS, CE } from "./embedStyle";

const TICK_MS = 30 * 60 * 1000;          // check every 30 minutes
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000; // send reminder when ≤ 24h remains

export function startLOAScheduler(client: Client): void {
  setInterval(() => void tick(client), TICK_MS);
  logger.info("LOA scheduler started (30min tick)");
}

async function tick(client: Client): Promise<void> {
  const active = await getAllActiveLOAsAcrossGuilds();
  if (active.length === 0) return;

  const now = Date.now();

  for (const { guildId, loa } of active) {
    if (!loa.returnDate) continue;

    const returnTs = parseReturnTs(loa.returnDate);
    if (!returnTs) continue; // unparseable free-text date — skip

    try {
      const cfg = await getGuildConfig(guildId);
      const loaLogId = cfg.channels.loaLog;
      const guildName = client.guilds.cache.get(guildId)?.name ?? guildId;

      if (returnTs < now) {
        // ── Return date has passed — auto-expire ────────────────────────────
        const ended = await autoEndLOAById(guildId, loa.id);
        if (!ended) continue; // already ended (race between ticks)

        logger.info({ guildId, userId: loa.userId, id: loa.id }, "LOA scheduler: auto-expired");

        // DM the staff member
        client.users.fetch(loa.userId).then(user =>
          user.send({
            embeds: [prettyEmbed({
              title: "Your LOA Has Expired",
              description: `${CE.information.str}\n\n${buildBullets([
                { label: "Server",      value: guildName },
                { label: "Return date", value: loa.returnDate! },
                { label: "Status",      value: "Automatically marked as ended — your return date has passed" },
              ])}\n\nIf you need more time please submit a new \`/loa request\`.`,
              color: COLORS.warning,
              footer: "Relosta Bot",
            })],
          })
        ).catch(() => {});

        // Post to LOA log channel
        if (loaLogId) {
          const guild = client.guilds.cache.get(guildId);
          const ch = guild ? await guild.channels.fetch(loaLogId).catch(() => null) : null;
          if (ch && ch.type === ChannelType.GuildText) {
            await (ch as GuildTextBasedChannel).send({
              embeds: [prettyEmbed({
                title: "LOA Auto-Expired",
                description: buildBullets([
                  { label: "Staff Member", value: `<@${loa.userId}>` },
                  { label: "Return Date",  value: loa.returnDate! },
                  { label: "Reason",       value: loa.reason },
                  { label: "Note",         value: "Return date passed without manual `/loa end`" },
                ]),
                color: COLORS.warning,
                footer: "Relosta Bot",
              })],
            }).catch(() => {});
          }
        }

      } else if (returnTs - now <= REMINDER_WINDOW_MS && !loa.reminderSent) {
        // ── Return date is within 24 hours — send reminder ──────────────────
        await markLOAReminderSent(guildId, loa.id);

        const hoursLeft = Math.max(1, Math.round((returnTs - now) / 3_600_000));

        client.users.fetch(loa.userId).then(user =>
          user.send({
            embeds: [prettyEmbed({
              title: "LOA Return Reminder",
              description: `${CE.warning.str}\n\n${buildBullets([
                { label: "Server",      value: guildName },
                { label: "Return date", value: loa.returnDate! },
                { label: "Time left",   value: `~${hoursLeft}h` },
              ])}\n\nUse \`/loa end\` when you're back, or submit a new \`/loa request\` if you need more time.`,
              color: COLORS.warning,
              footer: "Relosta Bot",
            })],
          })
        ).catch(() => {});

        logger.info({ guildId, userId: loa.userId, id: loa.id, hoursLeft }, "LOA scheduler: return reminder sent");
      }
    } catch (err) {
      logger.error({ err, guildId, id: loa.id }, "LOA scheduler tick error");
    }
  }
}