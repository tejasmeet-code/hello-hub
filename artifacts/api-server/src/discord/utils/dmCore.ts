import type { Guild, GuildMember, Role, User } from "discord.js";
import { logger } from "../../lib/logger";

export interface DmTarget {
  user?: User | null;
  member?: GuildMember | null;
  role?: Role | null;
  everyone?: boolean;
}

export interface DmResult {
  sent: number;
  failed: number;
  label: string;
  total: number;
}

export const DM_INTERVAL_MS = 1500;
export const MAX_RECIPIENTS_HARD_CAP = 5000;

/**
 * Resolve a target (user, role, or everyone) to a deduped map of users.
 * Filters out bots automatically.
 */
export async function resolveDmRecipients(
  guild: Guild,
  target: DmTarget,
): Promise<{ users: Map<string, User>; label: string }> {
  if (target.everyone) {
    const members = await guild.members.fetch().catch((err) => {
      logger.warn({ err }, "Failed to fetch members for DM");
      throw new Error(
        "I couldn't load the server's member list. Make sure the **Server Members Intent** is enabled in the Discord Developer Portal.",
      );
    });
    const users = new Map<string, User>();
    for (const m of members.values()) {
      if (!m.user.bot) users.set(m.user.id, m.user);
    }
    return { users, label: "everyone" };
  }

  if (target.role) {
    await guild.members.fetch().catch((err) => {
      logger.warn({ err }, "Failed to fetch members for role DM");
      throw new Error(
        "I couldn't load the server's member list. Make sure the **Server Members Intent** is enabled in the Discord Developer Portal.",
      );
    });
    const role = await guild.roles.fetch(target.role.id).catch(() => null);
    if (!role) throw new Error("Couldn't find that role.");
    const users = new Map<string, User>();
    for (const m of role.members.values()) {
      if (!m.user.bot) users.set(m.user.id, m.user);
    }
    return { users, label: `role @${role.name}` };
  }

  if (target.member) {
    const u = target.member.user;
    if (u.bot) return { users: new Map(), label: u.tag };
    return { users: new Map([[u.id, u]]), label: u.tag };
  }

  if (target.user) {
    if (target.user.bot) return { users: new Map(), label: target.user.tag };
    return { users: new Map([[target.user.id, target.user]]), label: target.user.tag };
  }

  throw new Error("No DM target provided.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a message to every user in the map with a delay between sends so we
 * don't trip Discord's per-bot DM rate limits. Returns sent/failed counts.
 */
export async function sendDmsToUsers(
  users: Map<string, User>,
  content: string,
  intervalMs: number = DM_INTERVAL_MS,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  let i = 0;
  const total = users.size;
  for (const user of users.values()) {
    try {
      await user.send(content);
      sent++;
    } catch (err) {
      failed++;
      logger.debug({ err, userId: user.id }, "DM failed");
    }
    i++;
    if (i < total && intervalMs > 0) await sleep(intervalMs);
  }
  return { sent, failed };
}

/**
 * Estimate of how long a DM run will take, in seconds.
 */
export function estimateDmSeconds(count: number, intervalMs = DM_INTERVAL_MS): number {
  if (count <= 1) return 0;
  return Math.round(((count - 1) * intervalMs) / 1000);
}
