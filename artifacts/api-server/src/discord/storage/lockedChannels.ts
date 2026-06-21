import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface LockEntry {
  codeHash: string;
  hint?: string;
  createdBy: string;
  createdAt: number;
}

interface LockShape {
  // perGuild[guildId][channelId] = entry
  perGuild: Record<string, Record<string, LockEntry>>;
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const FILE_PATH = path.join(DATA_DIR, "lockedChannels.json");

let cache: LockShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<LockShape> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<LockShape>;
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

async function persist(data: LockShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function hashCode(code: string): string {
  return createHash("sha256")
    .update(code.trim().toLowerCase())
    .digest("hex");
}

export async function setLock(
  guildId: string,
  channelId: string,
  code: string,
  createdBy: string,
  hint?: string,
): Promise<void> {
  const data = await load();
  if (!data.perGuild[guildId]) data.perGuild[guildId] = {};
  data.perGuild[guildId][channelId] = {
    codeHash: hashCode(code),
    hint,
    createdBy,
    createdAt: Date.now(),
  };
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
}

export async function removeLock(
  guildId: string,
  channelId: string,
): Promise<boolean> {
  const data = await load();
  const bucket = data.perGuild[guildId];
  if (!bucket || !bucket[channelId]) return false;
  delete bucket[channelId];
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function getLock(
  guildId: string,
  channelId: string,
): Promise<LockEntry | null> {
  const data = await load();
  return data.perGuild[guildId]?.[channelId] ?? null;
}

export async function listLocks(
  guildId: string,
): Promise<{ channelId: string; entry: LockEntry }[]> {
  const data = await load();
  const bucket = data.perGuild[guildId];
  if (!bucket) return [];
  return Object.entries(bucket).map(([channelId, entry]) => ({
    channelId,
    entry,
  }));
}

export function checkCode(code: string, entry: LockEntry): boolean {
  return hashCode(code) === entry.codeHash;
}
