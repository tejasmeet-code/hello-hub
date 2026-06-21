import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "loa";
const FILE = () => dataFile("loa.json");

export type LOAStatus = "pending" | "approved" | "denied" | "ended";

export interface LOARequest {
  id: string;
  guildId: string;
  userId: string;
  reason: string;
  returnDate: string | null;
  status: LOAStatus;
  requestedAt: number;
  reviewedBy: string | null;
  reviewedAt: number | null;
  endedAt: number | null;
  reminderSent?: boolean;
}

interface Store {
  [guildId: string]: LOARequest[];
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

/**
 * Parse a free-text return date string into a UTC timestamp.
 * Handles ISO dates, "May 10", "10 May", "May 10 2025", etc.
 * Returns null if unparseable.
 */
export function parseReturnTs(dateStr: string): number | null {
  if (!dateStr.trim()) return null;

  let d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    if (d.getTime() < Date.now() && !/\d{4}/.test(dateStr)) {
      const next = new Date(`${dateStr} ${new Date().getFullYear() + 1}`);
      if (!isNaN(next.getTime())) return next.getTime();
    }
    return d.getTime();
  }

  const year = new Date().getFullYear();
  d = new Date(`${dateStr} ${year}`);
  if (!isNaN(d.getTime())) {
    if (d.getTime() < Date.now()) {
      const next = new Date(`${dateStr} ${year + 1}`);
      if (!isNaN(next.getTime())) return next.getTime();
    }
    return d.getTime();
  }

  return null;
}

export async function createLOA(
  guildId: string,
  userId: string,
  reason: string,
  returnDate: string | null,
): Promise<LOARequest> {
  const store = await load();
  if (!store[guildId]) store[guildId] = [];
  const req: LOARequest = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    guildId, userId, reason, returnDate,
    status: "pending",
    requestedAt: Date.now(),
    reviewedBy: null,
    reviewedAt: null,
    endedAt: null,
    reminderSent: false,
  };
  store[guildId].push(req);
  await save(store);
  return req;
}

export async function getLOAsForGuild(guildId: string, status?: LOAStatus): Promise<LOARequest[]> {
  const store = await load();
  const all = store[guildId] ?? [];
  return status ? all.filter((r) => r.status === status) : all;
}

export async function getActiveLOAForUser(guildId: string, userId: string): Promise<LOARequest | null> {
  const store = await load();
  return (store[guildId] ?? []).find((r) => r.userId === userId && r.status === "approved") ?? null;
}

export async function getPendingLOAForUser(guildId: string, userId: string): Promise<LOARequest | null> {
  const store = await load();
  return (store[guildId] ?? []).find((r) => r.userId === userId && r.status === "pending") ?? null;
}

export async function updateLOAStatus(
  guildId: string,
  id: string,
  status: LOAStatus,
  reviewedBy: string,
): Promise<boolean> {
  const store = await load();
  const req = (store[guildId] ?? []).find((r) => r.id === id);
  if (!req) return false;
  req.status = status;
  req.reviewedBy = reviewedBy;
  req.reviewedAt = Date.now();
  await save(store);
  return true;
}

export async function getLOAsForUser(guildId: string, userId: string): Promise<LOARequest[]> {
  const store = await load();
  return (store[guildId] ?? [])
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.requestedAt - a.requestedAt);
}

export async function getAllActiveLOAsAcrossGuilds(): Promise<{ guildId: string; loa: LOARequest }[]> {
  const store = await load();
  const out: { guildId: string; loa: LOARequest }[] = [];
  for (const [guildId, loas] of Object.entries(store)) {
    for (const loa of loas) {
      if (loa.status === "approved") out.push({ guildId, loa });
    }
  }
  return out;
}

export async function markLOAReminderSent(guildId: string, id: string): Promise<void> {
  const store = await load();
  const req = (store[guildId] ?? []).find((r) => r.id === id);
  if (!req) return;
  req.reminderSent = true;
  await save(store);
}

export async function autoEndLOAById(guildId: string, id: string): Promise<LOARequest | null> {
  const store = await load();
  const req = (store[guildId] ?? []).find((r) => r.id === id && r.status === "approved");
  if (!req) return null;
  req.status = "ended";
  req.endedAt = Date.now();
  req.reviewedBy = "Relosta Bot (auto-expired)";
  req.reviewedAt = Date.now();
  await save(store);
  return req;
}

export async function endLOA(guildId: string, userId: string): Promise<LOARequest | null> {
  const store = await load();
  const req = (store[guildId] ?? []).find((r) => r.userId === userId && r.status === "approved");
  if (!req) return null;
  req.status = "ended";
  req.endedAt = Date.now();
  await save(store);
  return req;
}