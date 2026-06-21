import { promises as fs } from "node:fs";
import path from "node:path";

interface VerifiedServersShape {
  // serverIds that have been verified by owner
  verified: Set<string>;
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const FILE_PATH = path.join(DATA_DIR, "verified-servers.json");

let cache: VerifiedServersShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<VerifiedServersShape> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { verified?: string[] };
    cache = {
      verified: new Set(
        Array.isArray(parsed.verified) ? parsed.verified : [],
      ),
    };
  } catch {
    cache = { verified: new Set() };
  }
  return cache;
}

async function persist(data: VerifiedServersShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    FILE_PATH,
    JSON.stringify(
      {
        verified: Array.from(data.verified),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function isServerVerified(serverId: string): Promise<boolean> {
  const data = await load();
  return data.verified.has(serverId);
}

export async function markServerAsVerified(serverId: string): Promise<boolean> {
  const data = await load();
  if (data.verified.has(serverId)) return false;
  data.verified.add(serverId);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}
