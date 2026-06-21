import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export interface Appeal {
  id: number;
  guild_id: string;
  case_number: number;
  user_id: string;
  punishment_type: string;
  why_happened: string;
  defense: string;
  proof: string | null;
  status: "pending" | "accepted" | "rejected";
  reviewed_by: string | null;
  created_at: string;
}

interface Store {
  nextId: number;
  appeals: Appeal[];
}

const FILE_PATH = dataFile("appeals.json");

let cache: Store | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Store> {
  if (cache) return cache;
  cache = await loadPersistentJson("appeals.json", FILE_PATH, {
    nextId: 1,
    appeals: [],
  });
  return cache;
}

async function persist(store: Store): Promise<void> {
  await persistPersistentJson("appeals.json", FILE_PATH, store);
}

function queueWrite(store: Store): void {
  writeQueue = writeQueue.then(() => persist(store)).catch(() => {});
}

export async function createAppeal(input: {
  guildId: string;
  caseNumber: number;
  userId: string;
  punishmentType: string;
  whyHappened: string;
  defense: string;
  proof?: string | null;
}): Promise<Appeal> {
  const store = await load();
  const appeal: Appeal = {
    id: store.nextId++,
    guild_id: input.guildId,
    case_number: input.caseNumber,
    user_id: input.userId,
    punishment_type: input.punishmentType,
    why_happened: input.whyHappened,
    defense: input.defense,
    proof: input.proof ?? null,
    status: "pending",
    reviewed_by: null,
    created_at: new Date().toISOString(),
  };
  store.appeals.push(appeal);
  queueWrite(store);
  return appeal;
}

export async function getAppeal(id: number): Promise<Appeal | null> {
  const store = await load();
  return store.appeals.find((a) => a.id === id) ?? null;
}

export async function updateAppealStatus(
  id: number,
  status: "accepted" | "rejected",
  reviewedBy: string,
): Promise<Appeal | null> {
  const store = await load();
  const appeal = store.appeals.find((a) => a.id === id);
  if (!appeal) return null;
  appeal.status = status;
  appeal.reviewed_by = reviewedBy;
  queueWrite(store);
  return appeal;
}

export async function listPendingAppeals(guildId: string): Promise<Appeal[]> {
  const store = await load();
  return store.appeals.filter(
    (a) => a.guild_id === guildId && a.status === "pending",
  );
}

export async function hasOpenAppeal(guildId: string, userId: string): Promise<boolean> {
  const store = await load();
  return store.appeals.some(
    (a) => a.guild_id === guildId && a.user_id === userId && a.status === "pending",
  );
}

/** Returns all pending appeals across every guild (used by the auto-close scheduler). */
export async function getAllPendingAppeals(): Promise<Appeal[]> {
  const store = await load();
  return store.appeals.filter(a => a.status === "pending");
}