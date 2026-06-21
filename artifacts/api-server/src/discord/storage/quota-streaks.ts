import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "quota-streaks";
const FILE = () => dataFile("quota-streaks.json");

export interface QuotaStreak {
  guild_id: string;
  user_id: string;
  consecutive_fails: number;
  last_check_week: number;
}

interface Store {
  [guildId: string]: { [userId: string]: QuotaStreak };
}

let cache: Store | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Store> {
  if (cache) return cache;
  cache = await loadPersistentJson<Store>(STORE, FILE(), {});
  return cache;
}

async function save(store: Store): Promise<void> {
  cache = store;
  writeQueue = writeQueue.then(() => persistPersistentJson(STORE, FILE(), store));
  return writeQueue;
}

export async function getStreak(guildId: string, userId: string): Promise<QuotaStreak> {
  const store = await load();
  return store[guildId]?.[userId] ?? {
    guild_id: guildId,
    user_id: userId,
    consecutive_fails: 0,
    last_check_week: 0,
  };
}

export async function resetStreak(guildId: string, userId: string, weekStart: number): Promise<void> {
  const store = await load();
  if (!store[guildId]) store[guildId] = {};
  store[guildId][userId] = { guild_id: guildId, user_id: userId, consecutive_fails: 0, last_check_week: weekStart };
  await save(store);
}

export async function incrementStreak(guildId: string, userId: string, weekStart: number): Promise<number> {
  const store = await load();
  if (!store[guildId]) store[guildId] = {};
  const current = store[guildId][userId] ?? { guild_id: guildId, user_id: userId, consecutive_fails: 0, last_check_week: 0 };
  const newCount = current.consecutive_fails + 1;
  store[guildId][userId] = { guild_id: guildId, user_id: userId, consecutive_fails: newCount, last_check_week: weekStart };
  await save(store);
  return newCount;
}