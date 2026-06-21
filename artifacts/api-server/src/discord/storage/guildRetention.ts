import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, dataFile } from "../../lib/paths";
import { logger } from "../../lib/logger";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const FILE_PATH = dataFile("guild-retention.json");

export interface RetentionEntry {
  guildName: string;
  leftAt: number;
  deleteAt: number;
}

interface RetentionStore {
  pending: Record<string, RetentionEntry>;
}

let cache: RetentionStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<RetentionStore> {
  if (cache) return cache;
  cache = await loadPersistentJson("guild-retention.json", FILE_PATH, {
    pending: {},
  });
  if (!cache.pending) cache.pending = {};
  return cache;
}

async function persist(store: RetentionStore): Promise<void> {
  await persistPersistentJson("guild-retention.json", FILE_PATH, store);
}

function queueWrite(store: RetentionStore): void {
  writeQueue = writeQueue.then(() => persist(store)).catch(() => {});
}

/** Called when the bot is removed from / leaves a guild. */
export async function scheduleGuildDeletion(
  guildId: string,
  guildName: string,
): Promise<void> {
  const store = await load();
  if (store.pending[guildId]) return; // already scheduled
  const now = Date.now();
  store.pending[guildId] = {
    guildName,
    leftAt: now,
    deleteAt: now + RETENTION_MS,
  };
  queueWrite(store);
  logger.info(
    { guildId, guildName, deleteAt: new Date(now + RETENTION_MS).toISOString() },
    "guildRetention: scheduled data deletion in 90 days",
  );
}

/** Called when the bot rejoins a guild — cancels any pending deletion. */
export async function cancelGuildDeletion(guildId: string): Promise<void> {
  const store = await load();
  if (!store.pending[guildId]) return;
  const { guildName } = store.pending[guildId];
  delete store.pending[guildId];
  queueWrite(store);
  logger.info({ guildId, guildName }, "guildRetention: cancelled scheduled deletion (bot rejoined)");
}

/** Check all pending guilds and purge those whose 90-day window has expired. */
export async function purgeExpiredGuilds(): Promise<void> {
  const store = await load();
  const now = Date.now();
  const expired = Object.entries(store.pending).filter(([, v]) => now >= v.deleteAt);
  if (expired.length === 0) return;

  for (const [guildId, entry] of expired) {
    logger.info({ guildId, guildName: entry.guildName }, "guildRetention: purging expired guild data");
    await purgeGuildData(guildId);
    delete store.pending[guildId];
    queueWrite(store);
    logger.info({ guildId }, "guildRetention: purge complete");
  }
}

/**
 * Hard-delete all stored data for a guild across every storage file.
 * Operates directly on JSON files so it works regardless of in-memory
 * cache state (bot will pick up the clean state on next access / restart).
 */
async function purgeGuildData(guildId: string): Promise<void> {
  await Promise.all([
    purgeKeyedFile(dataFile("config.json"), guildId),
    purgeKeyedFile(dataFile("staff.json"), guildId),
    purgeKeyedFile(dataFile("cases.json"), guildId),
    purgeKeyedFile(dataFile("quota.json"), guildId),
    purgeKeyedFile(dataFile("modstats.json"), guildId),
    purgeKeyedFile(dataFile("jail.json"), guildId),
    purgeKeyedFile(dataFile("loa.json"), guildId),
    purgeKeyedFile(dataFile("quota-streaks.json"), guildId),
    purgeAppeals(guildId),
    purgeWarnings(guildId),
    purgeConnections(guildId),
    purgeKeyedFile(dataFile("notes.json"), guildId),
    purgeWhitelist(guildId),
    purgeSetFile(dataFile("verified-servers.json"), "verified", guildId),
    purgeSetFile(dataFile("nuke-anti-whitelist.json"), "protected", guildId),
  ]);
}

/** Remove a top-level guildId key from a `Record<guildId, ...>` JSON file. */
async function purgeKeyedFile(filePath: string, guildId: string): Promise<void> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!(guildId in data)) return;
    delete data[guildId];
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // File doesn't exist or can't be read — nothing to purge
  }
}

/** Filter out all appeals belonging to this guild. */
async function purgeAppeals(guildId: string): Promise<void> {
  try {
    const filePath = dataFile("appeals.json");
    const raw = await fs.readFile(filePath, "utf8");
    const store = JSON.parse(raw) as { nextId: number; appeals: { guild_id: string }[] };
    store.appeals = store.appeals.filter((a) => a.guild_id !== guildId);
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch { }
}

/** Filter out all warnings belonging to this guild. */
async function purgeWarnings(guildId: string): Promise<void> {
  try {
    const filePath = dataFile("warnings.json");
    const raw = await fs.readFile(filePath, "utf8");
    const store = JSON.parse(raw) as { warnings: { guildId: string }[] };
    store.warnings = store.warnings.filter((w) => w.guildId !== guildId);
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch { }
}

/** Remove active connections that involve this guild. */
async function purgeConnections(guildId: string): Promise<void> {
  try {
    const filePath = dataFile("connections.json");
    const raw = await fs.readFile(filePath, "utf8");
    const store = JSON.parse(raw) as {
      pending: { fromGuildId: string; toGuildId: string }[];
      active: { guildAId: string; guildBId: string }[];
    };
    store.pending = store.pending.filter(
      (p) => p.fromGuildId !== guildId && p.toGuildId !== guildId,
    );
    store.active = store.active.filter(
      (a) => a.guildAId !== guildId && a.guildBId !== guildId,
    );
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch { }
}

/** Delete the per-guild notes file. */
async function purgeNoteFile(_guildId: string): Promise<void> {
  // Notes are stored as a keyed JSON file; per-guild purge is handled by purgeKeyedFile.
}

/** Remove per-guild whitelist entries (`perGuild[guildId]` and `guildAll[guildId]`). */
async function purgeWhitelist(guildId: string): Promise<void> {
  try {
    const filePath = dataFile("whitelist.json");
    const raw = await fs.readFile(filePath, "utf8");
    const store = JSON.parse(raw) as {
      perGuild?: Record<string, unknown>;
      guildAll?: Record<string, unknown>;
    };
    let changed = false;
    if (store.perGuild && guildId in store.perGuild) {
      delete store.perGuild[guildId];
      changed = true;
    }
    if (store.guildAll && guildId in store.guildAll) {
      delete store.guildAll[guildId];
      changed = true;
    }
    if (changed) await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch { }
}

/**
 * Remove a guild ID from an array-backed Set field in a JSON file.
 * Used for `verified-servers.json` → `verified` and
 * `nuke-anti-whitelist.json` → `protected`.
 */
async function purgeSetFile(filePath: string, field: string, guildId: string): Promise<void> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const store = JSON.parse(raw) as Record<string, string[]>;
    if (!Array.isArray(store[field])) return;
    const before = store[field].length;
    store[field] = store[field].filter((id) => id !== guildId);
    if (store[field].length !== before) {
      await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
    }
  } catch { }
}