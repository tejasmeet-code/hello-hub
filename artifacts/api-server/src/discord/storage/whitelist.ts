import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

/**
 * Hardcoded baseline of users who are always on the global whitelist.
 * These IDs cannot be removed at runtime — they're guaranteed by code.
 */
export const BASE_PERM_WHITELIST: ReadonlySet<string> = new Set([
  "1181221352393420856",
  "1384512046200127570",
  "867277178684178453",
  "1466728565352435847",
  "1414620491544658021",
  "1209755174420221984",
]);

// Internal mutable set seeded from the baseline. Runtime additions are merged
// in by initPermWhitelist() at bot startup.
const _permWhitelist = new Set<string>(BASE_PERM_WHITELIST);

/**
 * Effective global whitelist (baseline + persisted runtime additions).
 * Exposed as ReadonlySet so consumers can't mutate it directly — use the
 * add/remove helpers below instead.
 */
export const PERM_WHITELIST: ReadonlySet<string> = _permWhitelist;

export const WHITELISTED_COMMANDS = [
  "ban",
  "mute",
  "unmute",
  "warn",
  "dm",
  "say",
  "jail",
  "kick",
  "timeout",
  "unban",
  "purge",
  "slowmode",
  "lock",
  "unlock",
  "vcmute",
  "vcdeafen",
  "vcmove",
  "vckick",
  "rolegive",
  "roleremove",
  "roleinfo",
  "nickname",
  "announce",
  "poll",
  "note",
  "modhistory",
  "case",
  "edit-case",
  "ban-request",
  "loa",
  "untimeout",
  "giveaway",
] as const;

export type WhitelistedCommand = (typeof WHITELISTED_COMMANDS)[number];

interface WhitelistShape {
  // perGuild[guildId][commandName] = [userId, ...]
  perGuild: Record<string, Record<string, string[]>>;
  // guildAll[guildId] = [userId, ...]  (whitelisted for every restricted command in that guild)
  guildAll: Record<string, string[]>;
}

const FILE_PATH = dataFile("whitelist.json");
const PERM_FILE_PATH = dataFile("perm-whitelist.json");

let cache: WhitelistShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let permWriteQueue: Promise<void> = Promise.resolve();
let permLoaded = false;

interface PermWhitelistShape {
  // Runtime additions only (the baseline lives in BASE_PERM_WHITELIST).
  extras: string[];
}

async function persistPermExtras(): Promise<void> {
  const extras = [...PERM_WHITELIST].filter(
    (id) => !BASE_PERM_WHITELIST.has(id),
  );
  const data: PermWhitelistShape = { extras };
  await persistPersistentJson("perm-whitelist.json", PERM_FILE_PATH, data);
}

/**
 * Load any persisted runtime additions to the global whitelist into the
 * in-memory set. Idempotent — safe to call more than once.
 */
export async function initPermWhitelist(): Promise<void> {
  if (permLoaded) return;
  permLoaded = true;
  const parsed = await loadPersistentJson<Partial<PermWhitelistShape>>(
    "perm-whitelist.json",
    PERM_FILE_PATH,
    { extras: [] },
  );
  if (Array.isArray(parsed.extras)) {
    for (const id of parsed.extras) {
      if (typeof id === "string" && /^\d+$/.test(id)) _permWhitelist.add(id);
    }
  }
}

export function isInBasePermWhitelist(userId: string): boolean {
  return BASE_PERM_WHITELIST.has(userId);
}

export async function addToPermWhitelist(userId: string): Promise<boolean> {
  await initPermWhitelist();
  if (_permWhitelist.has(userId)) return false;
  _permWhitelist.add(userId);
  permWriteQueue = permWriteQueue.then(() => persistPermExtras()).catch(() => {});
  await permWriteQueue;
  return true;
}

export async function removeFromPermWhitelist(userId: string): Promise<boolean> {
  await initPermWhitelist();
  if (BASE_PERM_WHITELIST.has(userId)) return false;
  if (!_permWhitelist.has(userId)) return false;
  _permWhitelist.delete(userId);
  permWriteQueue = permWriteQueue.then(() => persistPermExtras()).catch(() => {});
  await permWriteQueue;
  return true;
}

export async function listPermWhitelist(): Promise<{
  base: string[];
  extras: string[];
}> {
  await initPermWhitelist();
  const base = [...BASE_PERM_WHITELIST];
  const extras = [...PERM_WHITELIST].filter(
    (id) => !BASE_PERM_WHITELIST.has(id),
  );
  return { base, extras };
}

async function load(): Promise<WhitelistShape> {
  if (cache) return cache;
  const parsed = await loadPersistentJson<Partial<WhitelistShape>>(
    "whitelist.json",
    FILE_PATH,
    { perGuild: {}, guildAll: {} },
  );
  cache = {
    perGuild:
      parsed.perGuild && typeof parsed.perGuild === "object"
        ? parsed.perGuild
        : {},
    guildAll:
      parsed.guildAll && typeof parsed.guildAll === "object"
        ? parsed.guildAll
        : {},
  };
  return cache;
}

async function persist(data: WhitelistShape): Promise<void> {
  await persistPersistentJson("whitelist.json", FILE_PATH, data);
}

function ensureBucket(
  data: WhitelistShape,
  guildId: string,
  command: string,
): string[] {
  if (!data.perGuild[guildId]) data.perGuild[guildId] = {};
  if (!data.perGuild[guildId][command]) data.perGuild[guildId][command] = [];
  return data.perGuild[guildId][command];
}

export async function isWhitelisted(
  command: WhitelistedCommand,
  guildId: string,
  userId: string,
): Promise<boolean> {
  if (PERM_WHITELIST.has(userId)) return true;
  const data = await load();
  if (data.guildAll[guildId]?.includes(userId)) return true;
  return data.perGuild[guildId]?.[command]?.includes(userId) ?? false;
}

export async function isOnGuildAllWhitelist(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const data = await load();
  return data.guildAll[guildId]?.includes(userId) ?? false;
}

export async function addToGuildAllWhitelist(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const data = await load();
  if (!data.guildAll[guildId]) data.guildAll[guildId] = [];
  if (data.guildAll[guildId].includes(userId)) return false;
  data.guildAll[guildId].push(userId);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function removeFromGuildAllWhitelist(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const data = await load();
  const bucket = data.guildAll[guildId];
  if (!bucket) return false;
  const idx = bucket.indexOf(userId);
  if (idx === -1) return false;
  bucket.splice(idx, 1);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function listGuildAllWhitelist(
  guildId: string,
): Promise<string[]> {
  const data = await load();
  return [...(data.guildAll[guildId] ?? [])];
}

export async function addToWhitelist(
  command: WhitelistedCommand,
  guildId: string,
  userId: string,
): Promise<boolean> {
  const data = await load();
  const bucket = ensureBucket(data, guildId, command);
  if (bucket.includes(userId)) return false;
  bucket.push(userId);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function removeFromWhitelist(
  command: WhitelistedCommand,
  guildId: string,
  userId: string,
): Promise<boolean> {
  const data = await load();
  const bucket = data.perGuild[guildId]?.[command];
  if (!bucket) return false;
  const idx = bucket.indexOf(userId);
  if (idx === -1) return false;
  bucket.splice(idx, 1);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function listWhitelist(
  command: WhitelistedCommand,
  guildId: string,
): Promise<string[]> {
  const data = await load();
  return [...(data.perGuild[guildId]?.[command] ?? [])];
}
