import { promises as fs } from "node:fs";
import path from "node:path";

interface NukeAntiWhitelistShape {
  // serverIds that are protected from nuke
  protected: Set<string>;
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const FILE_PATH = path.join(DATA_DIR, "nuke-anti-whitelist.json");

let cache: NukeAntiWhitelistShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<NukeAntiWhitelistShape> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { protected?: string[] };
    cache = {
      protected: new Set(
        Array.isArray(parsed.protected) ? parsed.protected : [],
      ),
    };
  } catch {
    cache = { protected: new Set() };
  }
  return cache;
}

async function persist(data: NukeAntiWhitelistShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    FILE_PATH,
    JSON.stringify(
      {
        protected: Array.from(data.protected),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function isServerProtected(serverId: string): Promise<boolean> {
  const data = await load();
  return data.protected.has(serverId);
}

export async function addServerToAntiWhitelist(
  serverId: string,
): Promise<boolean> {
  const data = await load();
  if (data.protected.has(serverId)) return false;
  data.protected.add(serverId);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function removeServerFromAntiWhitelist(
  serverId: string,
): Promise<boolean> {
  const data = await load();
  if (!data.protected.has(serverId)) return false;
  data.protected.delete(serverId);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function listAntiWhitelistedServers(): Promise<string[]> {
  const data = await load();
  return Array.from(data.protected);
}
