import { promises as fs } from "node:fs";
import path from "node:path";

interface AntiWhitelistShape {
  // List of server IDs where nuke command is blocked even for global whitelisted users
  serverIds: string[];
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const FILE_PATH = path.join(DATA_DIR, "nuke-anti-whitelist.json");

let cache: AntiWhitelistShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<AntiWhitelistShape> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AntiWhitelistShape>;
    cache = {
      serverIds: Array.isArray(parsed.serverIds) ? parsed.serverIds : [],
    };
  } catch {
    cache = { serverIds: [] };
  }
  return cache;
}

async function persist(data: AntiWhitelistShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export async function isNukeBlocked(guildId: string): Promise<boolean> {
  const data = await load();
  return data.serverIds.includes(guildId);
}

export async function addNukeBlock(guildId: string): Promise<boolean> {
  const data = await load();
  if (data.serverIds.includes(guildId)) return false;
  data.serverIds.push(guildId);
  cache = data;
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function removeNukeBlock(guildId: string): Promise<boolean> {
  const data = await load();
  const index = data.serverIds.indexOf(guildId);
  if (index === -1) return false;
  data.serverIds.splice(index, 1);
  cache = data;
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function getNukeBlockList(): Promise<string[]> {
  const data = await load();
  return [...data.serverIds];
}
