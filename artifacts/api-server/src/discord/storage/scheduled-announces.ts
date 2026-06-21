import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "scheduled-announces";
const FILE = () => dataFile("scheduled-announces.json");

export interface ScheduledAnnounce {
  id: string;
  guildId: string;
  channelId: string;
  title: string;
  message: string;
  color: number;
  pingEveryone: boolean;
  scheduledFor: number;
  timezone: string;
  createdBy: string;
  createdByTag: string;
  createdAt: number;
}

interface Store {
  [guildId: string]: ScheduledAnnounce[];
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

export async function createScheduledAnnounce(
  data: Omit<ScheduledAnnounce, "id" | "createdAt">,
): Promise<ScheduledAnnounce> {
  const store = await load();
  if (!store[data.guildId]) store[data.guildId] = [];
  const entry: ScheduledAnnounce = {
    ...data,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    createdAt: Date.now(),
  };
  store[data.guildId].push(entry);
  await save(store);
  return entry;
}

export async function getScheduledForGuild(guildId: string): Promise<ScheduledAnnounce[]> {
  const store = await load();
  return (store[guildId] ?? []).sort((a, b) => a.scheduledFor - b.scheduledFor);
}

export async function getPendingAcrossAllGuilds(): Promise<ScheduledAnnounce[]> {
  const store = await load();
  const now = Date.now();
  const due: ScheduledAnnounce[] = [];
  for (const list of Object.values(store)) {
    for (const entry of list) {
      if (entry.scheduledFor <= now) due.push(entry);
    }
  }
  return due;
}

export async function deleteScheduledAnnounce(guildId: string, id: string): Promise<boolean> {
  const store = await load();
  const list = store[guildId] ?? [];
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  store[guildId] = list;
  await save(store);
  return true;
}

/**
 * Convert a user-supplied date (YYYY-MM-DD) + time (HH:MM, 24h) in the given
 * IANA timezone into a UTC Unix timestamp (ms). Returns null if input is invalid.
 */
export function toUtcTimestamp(dateStr: string, timeStr: string, tz: string): number | null {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    if (!/^\d{2}:\d{2}$/.test(timeStr)) return null;

    const naiveUtc = new Date(`${dateStr}T${timeStr}:00Z`);
    if (isNaN(naiveUtc.getTime())) return null;

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(naiveUtc);

    const p: Record<string, string> = {};
    for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;

    const hr = p.hour === "24" ? "00" : p.hour;
    const tzLocalAsUtc = new Date(`${p.year}-${p.month}-${p.day}T${hr}:${p.minute}:${p.second}Z`);
    if (isNaN(tzLocalAsUtc.getTime())) return null;

    const offset = naiveUtc.getTime() - tzLocalAsUtc.getTime();
    const desiredLocal = new Date(`${dateStr}T${timeStr}:00Z`);
    const result = desiredLocal.getTime() + offset;

    if (result <= Date.now()) return null;
    return result;
  } catch {
    return null;
  }
}