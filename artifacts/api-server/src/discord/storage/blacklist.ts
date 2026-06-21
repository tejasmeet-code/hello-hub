import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

/**
 * Hardcoded baseline of users who are always blacklisted globally.
 * These IDs cannot be removed at runtime — they're guaranteed by code.
 */
export const BASE_GLOBAL_BLACKLIST: ReadonlySet<string> = new Set([]);

// Internal mutable set seeded from the baseline. Runtime additions are merged
// in by initBlacklist() at bot startup.
const _globalBlacklist = new Set<string>(BASE_GLOBAL_BLACKLIST);

/**
 * Effective global blacklist (baseline + persisted runtime additions).
 * Exposed as ReadonlySet so consumers can't mutate it directly — use the
 * add/remove helpers below instead.
 */
export const GLOBAL_BLACKLIST: ReadonlySet<string> = _globalBlacklist;

/**
 * Hardcoded baseline of servers that are always blacklisted.
 * Bot will leave these servers immediately when added.
 */
export const BASE_SERVER_BLACKLIST: ReadonlySet<string> = new Set([]);

const _serverBlacklist = new Set<string>(BASE_SERVER_BLACKLIST);

/**
 * Effective server blacklist (baseline + persisted runtime additions).
 */
export const SERVER_BLACKLIST: ReadonlySet<string> = _serverBlacklist;

interface BlacklistShape {
  // globalUsers = [userId, ...] (blacklisted from all commands globally)
  globalUsers: string[];
  // servers = [guildId, ...] (bot leaves immediately)
  servers: string[];
  // perUserCommand[userId][commandName] = true (user can't use this command)
  perUserCommand: Record<string, Record<string, boolean>>;
}

const FILE_PATH = dataFile("blacklist.json");

let cache: BlacklistShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<BlacklistShape> {
  if (cache) return cache;
  const parsed = await loadPersistentJson<Partial<BlacklistShape>>(
    "blacklist.json",
    FILE_PATH,
    { globalUsers: [], servers: [], perUserCommand: {} },
  );
  cache = {
    globalUsers: Array.isArray(parsed.globalUsers) ? parsed.globalUsers : [],
    servers: Array.isArray(parsed.servers) ? parsed.servers : [],
    perUserCommand:
      parsed.perUserCommand && typeof parsed.perUserCommand === "object"
        ? parsed.perUserCommand
        : {},
  };
  return cache;
}

async function persist(data: BlacklistShape): Promise<void> {
  await persistPersistentJson("blacklist.json", FILE_PATH, data);
}

/**
 * Check if a user is globally blacklisted from all commands.
 */
export function isGloballyBlacklisted(userId: string): boolean {
  return GLOBAL_BLACKLIST.has(userId) || (cache?.globalUsers.includes(userId) ?? false);
}

/**
 * Check if a server is blacklisted (bot should leave).
 */
export function isServerBlacklisted(guildId: string): boolean {
  return SERVER_BLACKLIST.has(guildId) || (cache?.servers.includes(guildId) ?? false);
}

/**
 * Check if a user is blacklisted from a specific command.
 */
export async function isCommandBlacklisted(
  userId: string,
  command: string,
): Promise<boolean> {
  const data = await load();
  return data.perUserCommand[userId]?.[command] === true;
}

/**
 * Check if a user can use a command (not blacklisted globally or for that command).
 */
export async function canUseCommand(
  userId: string,
  command: string,
): Promise<boolean> {
  if (isGloballyBlacklisted(userId)) return false;
  return !(await isCommandBlacklisted(userId, command));
}

/**
 * Add a user to the global blacklist.
 */
export async function addToGlobalBlacklist(userId: string): Promise<boolean> {
  const data = await load();
  if (data.globalUsers.includes(userId)) return false;
  data.globalUsers.push(userId);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

/**
 * Remove a user from the global blacklist.
 */
export async function removeFromGlobalBlacklist(userId: string): Promise<boolean> {
  const data = await load();
  const idx = data.globalUsers.indexOf(userId);
  if (idx === -1) return false;
  data.globalUsers.splice(idx, 1);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

/**
 * Add a server to the blacklist (bot will leave).
 */
export async function addToServerBlacklist(guildId: string): Promise<boolean> {
  const data = await load();
  if (data.servers.includes(guildId)) return false;
  data.servers.push(guildId);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

/**
 * Remove a server from the blacklist.
 */
export async function removeFromServerBlacklist(guildId: string): Promise<boolean> {
  const data = await load();
  const idx = data.servers.indexOf(guildId);
  if (idx === -1) return false;
  data.servers.splice(idx, 1);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

/**
 * Blacklist a user from a specific command.
 */
export async function addCommandBlacklist(
  userId: string,
  command: string,
): Promise<boolean> {
  const data = await load();
  if (!data.perUserCommand[userId]) data.perUserCommand[userId] = {};
  if (data.perUserCommand[userId][command]) return false;
  data.perUserCommand[userId][command] = true;
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

/**
 * Remove a command blacklist for a user.
 */
export async function removeCommandBlacklist(
  userId: string,
  command: string,
): Promise<boolean> {
  const data = await load();
  if (!data.perUserCommand[userId]?.[command]) return false;
  delete data.perUserCommand[userId][command];
  // Clean up empty user objects
  if (Object.keys(data.perUserCommand[userId]).length === 0) {
    delete data.perUserCommand[userId];
  }
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

/**
 * Get all blacklisted users and servers.
 */
export async function listBlacklists(): Promise<{
  globalUsers: string[];
  servers: string[];
  perUserCommand: Record<string, Record<string, boolean>>;
}> {
  const data = await load();
  return {
    globalUsers: [...data.globalUsers],
    servers: [...data.servers],
    perUserCommand: { ...data.perUserCommand },
  };
}