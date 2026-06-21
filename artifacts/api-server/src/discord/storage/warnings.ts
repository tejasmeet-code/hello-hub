import { promises as fs } from "node:fs";
import path from "node:path";

export interface Warning {
  id: string;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  timestamp: number;
}

interface WarningStoreShape {
  warnings: Warning[];
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const FILE_PATH = path.join(DATA_DIR, "warnings.json");

let cache: WarningStoreShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<WarningStoreShape> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as WarningStoreShape;
    cache = { warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [] };
  } catch {
    cache = { warnings: [] };
  }
  return cache;
}

async function persist(data: WarningStoreShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function addWarning(
  input: Omit<Warning, "id" | "timestamp">,
): Promise<Warning> {
  const store = await load();
  const warning: Warning = {
    ...input,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  store.warnings.push(warning);
  writeQueue = writeQueue.then(() => persist(store)).catch(() => {});
  await writeQueue;
  return warning;
}

export async function getWarnings(
  guildId: string,
  userId: string,
): Promise<Warning[]> {
  const store = await load();
  return store.warnings.filter(
    (w) => w.guildId === guildId && w.userId === userId,
  );
}

export async function clearWarnings(
  guildId: string,
  userId: string,
): Promise<number> {
  const store = await load();
  const before = store.warnings.length;
  store.warnings = store.warnings.filter(
    (w) => !(w.guildId === guildId && w.userId === userId),
  );
  const removed = before - store.warnings.length;
  if (removed > 0) {
    writeQueue = writeQueue.then(() => persist(store)).catch(() => {});
    await writeQueue;
  }
  return removed;
}
