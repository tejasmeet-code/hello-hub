import { currentWeekStart } from "./quota";
import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export type ModAction =
  | "ban"
  | "unban"
  | "mute"
  | "unmute"
  | "warn"
  | "unwarn"
  | "jail"
  | "unjail"
  | "kick"
  | "untimeout";

export interface ModStatEntry {
  id: string;
  modId: string;
  targetId: string;
  action: ModAction;
  delta: 1 | -1;
  reason?: string;
  at: number;
}

interface GuildModStats {
  entries: ModStatEntry[];
}

const FILE_PATH = dataFile("modstats.json");

let cache: Record<string, GuildModStats> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, GuildModStats>> {
  if (cache) return cache;
  cache = await loadPersistentJson("modstats.json", FILE_PATH, {});
  return cache;
}

async function persist(data: Record<string, GuildModStats>): Promise<void> {
  await persistPersistentJson("modstats.json", FILE_PATH, data);
}

function ensureGuild(
  data: Record<string, GuildModStats>,
  guildId: string,
): GuildModStats {
  if (!data[guildId]) data[guildId] = { entries: [] };
  return data[guildId];
}

function queueWrite(data: Record<string, GuildModStats>): Promise<void> {
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  return writeQueue;
}

export async function recordModStat(input: {
  guildId: string;
  modId: string;
  targetId: string;
  action: ModAction;
  delta: 1 | -1;
  reason?: string;
}): Promise<ModStatEntry> {
  const data = await load();
  const g = ensureGuild(data, input.guildId);
  const entry: ModStatEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    modId: input.modId,
    targetId: input.targetId,
    action: input.action,
    delta: input.delta,
    reason: input.reason,
    at: Date.now(),
  };
  g.entries.push(entry);
  await queueWrite(data);
  return entry;
}

export async function listEntries(guildId: string): Promise<ModStatEntry[]> {
  const data = await load();
  return data[guildId]?.entries ?? [];
}

export type StatScope = "this_week" | "last_week" | "all_time";

export interface ModSummary {
  modId: string;
  total: number; // sum of deltas
  positive: number; // count of +1 entries
  negative: number; // count of -1 entries
  byAction: Record<ModAction, { positive: number; negative: number; net: number }>;
}

function emptyByAction(): ModSummary["byAction"] {
  const actions: ModAction[] = [
    "ban",
    "unban",
    "mute",
    "unmute",
    "warn",
    "unwarn",
    "jail",
    "unjail",
  ];
  const out = {} as ModSummary["byAction"];
  for (const a of actions) out[a] = { positive: 0, negative: 0, net: 0 };
  return out;
}

function rangeForScope(scope: StatScope, weekStartDay = 0, now = Date.now()): {
  start: number;
  end: number;
} {
  if (scope === "all_time") return { start: 0, end: Number.MAX_SAFE_INTEGER };
  const thisWeek = currentWeekStart(weekStartDay, now);
  if (scope === "this_week") return { start: thisWeek, end: Number.MAX_SAFE_INTEGER };
  const lastWeek = thisWeek - 7 * 86_400_000;
  return { start: lastWeek, end: thisWeek };
}

export async function summarizeMod(
  guildId: string,
  modId: string,
  scope: StatScope,
  weekStartDay = 0,
): Promise<ModSummary> {
  const entries = await listEntries(guildId);
  const { start, end } = rangeForScope(scope, weekStartDay);
  const summary: ModSummary = {
    modId,
    total: 0,
    positive: 0,
    negative: 0,
    byAction: emptyByAction(),
  };
  for (const e of entries) {
    if (e.modId !== modId) continue;
    if (e.at < start || e.at >= end) continue;
    summary.total += e.delta;
    if (e.delta > 0) summary.positive += 1;
    else summary.negative += 1;
    const slot = summary.byAction[e.action];
    if (e.delta > 0) slot.positive += 1;
    else slot.negative += 1;
    slot.net += e.delta;
  }
  return summary;
}

export async function leaderboard(
  guildId: string,
  scope: StatScope,
  weekStartDay = 0,
): Promise<ModSummary[]> {
  const entries = await listEntries(guildId);
  const { start, end } = rangeForScope(scope, weekStartDay);
  const map = new Map<string, ModSummary>();
  for (const e of entries) {
    if (e.at < start || e.at >= end) continue;
    let s = map.get(e.modId);
    if (!s) {
      s = {
        modId: e.modId,
        total: 0,
        positive: 0,
        negative: 0,
        byAction: emptyByAction(),
      };
      map.set(e.modId, s);
    }
    s.total += e.delta;
    if (e.delta > 0) s.positive += 1;
    else s.negative += 1;
    const slot = s.byAction[e.action];
    if (e.delta > 0) slot.positive += 1;
    else slot.negative += 1;
    slot.net += e.delta;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/**
 * Count how many positive (delta=+1) actions a moderator has performed in the
 * current week. Used by /profile to surface modstats next to quota.
 */
export async function weekPositiveCount(
  guildId: string,
  modId: string,
  weekStartDay = 0,
): Promise<number> {
  const s = await summarizeMod(guildId, modId, "this_week", weekStartDay);
  return s.positive;
}