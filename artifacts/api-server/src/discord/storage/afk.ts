import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "afk_users";
const FILE = () => dataFile("afk_users.json");

export interface AFKEntry {
  userId: string;
  reason: string;
  scope: "global" | "server";
  guildId?: string;
  timestamp: number;
}

interface Store {
  [userId: string]: AFKEntry;
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

export async function setAFK(
  userId: string,
  reason: string,
  scope: "global" | "server",
  guildId?: string,
): Promise<AFKEntry> {
  const store = await load();
  const entry: AFKEntry = {
    userId,
    reason,
    scope,
    guildId,
    timestamp: Date.now(),
  };
  store[userId] = entry;
  await save(store);
  return entry;
}

export async function removeAFK(userId: string): Promise<boolean> {
  const store = await load();
  if (!store[userId]) return false;
  delete store[userId];
  await save(store);
  return true;
}

export async function getAFK(userId: string): Promise<AFKEntry | null> {
  const store = await load();
  return store[userId] ?? null;
}
