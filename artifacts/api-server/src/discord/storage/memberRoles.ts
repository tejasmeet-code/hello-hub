import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export interface MemberRoleSnapshot {
  userId: string;
  roleIds: string[];
}

interface MemberRolesStore {
  guilds: Record<string, Record<string, string[]>>; // guildId -> userId -> roleIds[]
}

const FILE_PATH = dataFile("member-roles.json");

let cache: MemberRolesStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<MemberRolesStore> {
  if (cache) return cache;
  cache = await loadPersistentJson("member-roles.json", FILE_PATH, {
    guilds: {},
  });
  if (!cache.guilds) cache.guilds = {};
  return cache;
}

async function persist(store: MemberRolesStore): Promise<void> {
  await persistPersistentJson("member-roles.json", FILE_PATH, store);
}

function queueWrite(store: MemberRolesStore): void {
  writeQueue = writeQueue.then(() => persist(store)).catch(() => {});
}

/**
 * Save the current roles of a member to persistent storage
 */
export async function saveMemberRoles(guildId: string, userId: string, roleIds: string[]): Promise<void> {
  const store = await load();
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {};
  }
  store.guilds[guildId][userId] = roleIds;
  queueWrite(store);
}

/**
 * Get the saved roles for a member
 */
export async function getMemberRoles(guildId: string, userId: string): Promise<string[] | null> {
  const store = await load();
  return store.guilds[guildId]?.[userId] ?? null;
}

/**
 * Get all saved member roles for a guild
 */
export async function getAllMemberRolesForGuild(guildId: string): Promise<MemberRoleSnapshot[]> {
  const store = await load();
  const guildData = store.guilds[guildId] ?? {};
  return Object.entries(guildData).map(([userId, roleIds]) => ({
    userId,
    roleIds,
  }));
}

/**
 * Clear all saved roles for a member
 */
export async function clearMemberRoles(guildId: string, userId: string): Promise<void> {
  const store = await load();
  if (store.guilds[guildId]) {
    delete store.guilds[guildId][userId];
    queueWrite(store);
  }
}

/**
 * Clear all saved roles for a guild
 */
export async function clearGuildRoles(guildId: string): Promise<void> {
  const store = await load();
  if (store.guilds[guildId]) {
    delete store.guilds[guildId];
    queueWrite(store);
  }
}