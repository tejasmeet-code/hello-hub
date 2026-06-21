import type { Client } from "discord.js";
import { logger } from "../../lib/logger";
import { listGuildQuota, currentWeekStart, setWeekAction } from "../storage/quota";
import { getGuildConfig } from "../storage/config";
import { listStaffRoles, getHighestHeldStaffRole } from "../storage/staff";
import { getStreak, resetStreak, incrementStreak } from "../storage/quota-streaks";
import { recordModStat } from "../storage/modstats";
import { prettyEmbed, COLORS, CE } from "./embedStyle";
import { ChannelType } from "discord.js";

function getHighestHeldStaffRoleIds(member: { roles: { cache: Map<string, { id: string }> } }, roleIds: Set<string>): string[] {
  const held: string[] = [];
  for (const id of member.roles.cache.keys()) {
    if (roleIds.has(id)) held.push(id);
  }
  return held;
}

function msUntilFridayCheck(now = Date.now()): number {
  const d = new Date(now);
  const day = d.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  const next = new Date(d);
  next.setUTCDate(d.getUTCDate() + daysUntilFriday);
  next.setUTCHours(18, 29, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 7);
  return next.getTime() - now;
}

async function runQuotaCheck(client: Client): Promise<void> {
  logger.info("quotaScheduler: Running Friday quota check");

  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = await getGuildConfig(guild.id);
      if (!cfg.quotaConfig) continue;

      const { weekStartDay } = cfg.quotaConfig;
      const weekStart = currentWeekStart(weekStartDay);
      const allQuota = await listGuildQuota(guild.id);
      const staffRoles = await listStaffRoles(guild.id);
      const staffRoleIds = new Set(staffRoles.map((r) => r.roleId));

      const infChannelId = cfg.channels.infractions;
      const infChannel = infChannelId ? guild.channels.cache.get(infChannelId) : null;

      const whitelistRoles = new Set(cfg.quotaWhitelistRoles ?? []);

      for (const [userId, userQuota] of Object.entries(allQuota)) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;

        const heldStaffRoles = getHighestHeldStaffRoleIds(member as any, staffRoleIds);
        const heldStaffRole = staffRoles.find((r) => heldStaffRoles.includes(r.roleId)) ?? null;
        const isStaff = staffRoles.length === 0 || heldStaffRole !== null;
        if (!isStaff) continue;

        if (whitelistRoles.size > 0 && member.roles.cache.some((r) => whitelistRoles.has(r.id))) {
          logger.debug({ userId, guildId: guild.id }, "quotaScheduler: skipping whitelisted member");
          continue;
        }

        let msgReq = cfg.quotaConfig.messages;
        let modReq = cfg.quotaConfig.modActions;
        let quotaSource = "global";

        if (cfg.roleQuotas && Object.keys(cfg.roleQuotas).length > 0 && heldStaffRole) {
          const rq = cfg.roleQuotas[heldStaffRole.roleId];
          if (rq) {
            msgReq = rq.messages;
            modReq = rq.modActions;
            quotaSource = `<@&${heldStaffRole.roleId}>`;
          }
        }

        const thisWeek = userQuota.weekly.find((w) => w.weekStart === weekStart);
        const metMessages = (thisWeek?.messages ?? 0) >= msgReq;
        const metModActions = (thisWeek?.modActions ?? 0) >= modReq;
        const metQuota = metMessages && metModActions;

        if (metQuota) {
          await resetStreak(guild.id, userId, weekStart);
          await setWeekAction(guild.id, userId, weekStart, "none", true);

          if (infChannel && infChannel.type === ChannelType.GuildText) {
            await (infChannel as any).send({
              embeds: [prettyEmbed({
                title: "Quota Met",
                color: COLORS.success,
                description:
                  `${CE.success.str}\n\n` +
                  `<@${userId}> met their quota this week.\n` +
                  `Messages: **${thisWeek?.messages ?? 0}/${msgReq}** | Mod Actions: **${thisWeek?.modActions ?? 0}/${modReq}**\n` +
                  `Target source: ${quotaSource}`,
              })],
            }).catch(() => {});
          }
          continue;
        }

        const streak = await incrementStreak(guild.id, userId, weekStart);
        let action: "warning" | "strike" | "termination";
        if (streak === 1) action = "warning";
        else if (streak === 2) action = "strike";
        else action = "termination";

        await setWeekAction(guild.id, userId, weekStart, action, false);

        await recordModStat({
          guildId: guild.id,
          modId: "SYSTEM",
          targetId: userId,
          action: "warn",
          delta: -1,
          reason: `Automated quota ${action} (week ${new Date(weekStart).toDateString()})`,
        });

        const actionEmoji =
          action === "warning"     ? CE.warning.str :
          action === "strike"      ? CE.failure.str :
          CE.termination.str;

        const actionLabel =
          action === "warning"     ? `${CE.warning.str} Warning` :
          action === "strike"      ? `${CE.failure.str} Strike` :
          `${CE.termination.str} Termination`;

        const embed = prettyEmbed({
          title: `Quota Fail — ${actionLabel}`,
          color:
            action === "warning" ? COLORS.warning :
            action === "strike"  ? COLORS.danger  :
            COLORS.neutral,
          description: actionEmoji,
          fields: [
            { name: "Staff Member",       value: `<@${userId}>`, inline: true },
            { name: "Action",             value: actionLabel, inline: true },
            { name: "Consecutive Fails",  value: String(streak), inline: true },
            { name: "Messages",           value: `${thisWeek?.messages ?? 0}/${msgReq}`, inline: true },
            { name: "Mod Actions",        value: `${thisWeek?.modActions ?? 0}/${modReq}`, inline: true },
            { name: "Target Source",      value: quotaSource, inline: true },
          ],
          footer: `Week starting ${new Date(weekStart).toUTCString()} | ${
            streak === 1 ? "Week 1 fail — Warning issued" :
            streak === 2 ? "Week 2 consecutive fail — Strike issued" :
            "Week 3+ consecutive fail — Termination issued"
          }`,
        });

        if (infChannel && infChannel.type === ChannelType.GuildText) {
          await (infChannel as any).send({ embeds: [embed] }).catch(() => {});
        }

        const actionDescriptions: Record<typeof action, string> = {
          warning:
            `You have received a **${CE.warning.str} Warning** for failing to meet your weekly quota.`,
          strike:
            `You have received a **${CE.failure.str} Strike** for failing to meet quota 2 consecutive weeks.`,
          termination:
            `You have been **${CE.termination.str} Terminated** for failing to meet quota 3 consecutive weeks.`,
        };

        member.send({
          embeds: [prettyEmbed({
            title: `Quota ${actionLabel}`,
            color: action === "termination" ? COLORS.danger : COLORS.warning,
            description: actionDescriptions[action],
            fields: [
              { name: "Messages This Week",    value: `${thisWeek?.messages ?? 0}/${msgReq}`, inline: true },
              { name: "Mod Actions This Week", value: `${thisWeek?.modActions ?? 0}/${modReq}`, inline: true },
              { name: "Consecutive Fails",     value: String(streak), inline: true },
            ],
            footer: `Server: ${guild.name}`,
          })],
        }).catch(() => {});

        logger.info({ guildId: guild.id, userId, action, streak, quotaSource }, "quotaScheduler: action applied");
      }
    } catch (err) {
      logger.error({ err, guildId: guild.id }, "quotaScheduler: guild check failed");
    }
  }

  logger.info("quotaScheduler: Friday check complete");
}

let schedulerStarted = false;

export function startQuotaScheduler(client: Client): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  function scheduleNext(): void {
    const ms = msUntilFridayCheck();
    const nextDate = new Date(Date.now() + ms);
    logger.info({ nextCheck: nextDate.toUTCString(), msUntil: ms }, "quotaScheduler: next check scheduled");

    setTimeout(async () => {
      try {
        await runQuotaCheck(client);
      } catch (err) {
        logger.error({ err }, "quotaScheduler: runQuotaCheck threw");
      }
      scheduleNext();
    }, ms);
  }

  scheduleNext();
}