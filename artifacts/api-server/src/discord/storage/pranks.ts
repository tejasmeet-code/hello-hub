import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export type PrankType =
  | "spooky"
  | "scramble-channels"
  | "scramble-roles"
  | "upside-down"
  | "role-rainbow"
  | "emoji-channels"
  | "cursed-nicknames"
  | "role-mystery"
  | "channel-shuffle";

export interface PrankRecord<T = unknown> {
  type: PrankType;
  guildId: string;
  codeHash: string;
  hint?: string;
  data: T;
  createdBy: string;
  createdAt: number;
}

interface Shape {
  perGuild: Record<string, Partial<Record<PrankType, PrankRecord>>>;
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const FILE_PATH = path.join(DATA_DIR, "pranks.json");

let cache: Shape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Shape> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Shape>;
    cache = {
      perGuild:
        parsed.perGuild && typeof parsed.perGuild === "object"
          ? parsed.perGuild
          : {},
    };
  } catch {
    cache = { perGuild: {} };
  }
  return cache;
}

async function persist(data: Shape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data), "utf8");
}

function hashCode(code: string): string {
  return createHash("sha256")
    .update(code.trim().toLowerCase())
    .digest("hex");
}

export async function savePrank<T>(
  type: PrankType,
  guildId: string,
  code: string,
  data: T,
  createdBy: string,
  hint?: string,
): Promise<void> {
  const store = await load();
  if (!store.perGuild[guildId]) store.perGuild[guildId] = {};
  store.perGuild[guildId][type] = {
    type,
    guildId,
    codeHash: hashCode(code),
    hint,
    data,
    createdBy,
    createdAt: Date.now(),
  };
  writeQueue = writeQueue.then(() => persist(store)).catch(() => {});
  await writeQueue;
}

export async function getPrank<T>(
  type: PrankType,
  guildId: string,
): Promise<PrankRecord<T> | null> {
  const store = await load();
  return (store.perGuild[guildId]?.[type] as PrankRecord<T> | undefined) ?? null;
}

export async function removePrank(
  type: PrankType,
  guildId: string,
): Promise<boolean> {
  const store = await load();
  const bucket = store.perGuild[guildId];
  if (!bucket || !bucket[type]) return false;
  delete bucket[type];
  writeQueue = writeQueue.then(() => persist(store)).catch(() => {});
  await writeQueue;
  return true;
}

export function checkPrankCode(code: string, record: PrankRecord): boolean {
  return hashCode(code) === record.codeHash;
}
