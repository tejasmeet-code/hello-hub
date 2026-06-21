import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

/**
 * Resolves the on-disk location used by every storage module.
 *
 *   1. If `DATA_DIR` is set, use it as an absolute path.
 *      → On Railway, mount a volume here for persistence between deploys.
 *   2. Otherwise, fall back to `<cwd>/.data` (works on Replit, Docker, local).
 */
function resolveDataDir(): string {
  const env = process.env["DATA_DIR"];
  if (env && env.trim().length > 0) {
    return path.resolve(env.trim());
  }
  return path.resolve(process.cwd(), ".data");
}

export const DATA_DIR = resolveDataDir();

let ensured = false;

/**
 * Pre-create the data directory and report the resolved location. Safe to
 * call many times; only the first call hits the filesystem.
 */
export async function ensureDataDir(): Promise<void> {
  if (ensured) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  ensured = true;
  logger.info(
    { dataDir: DATA_DIR, override: Boolean(process.env["DATA_DIR"]) },
    "Storage data directory ready",
  );
}

/** Convenience helper for storage modules: resolves a file inside DATA_DIR. */
export function dataFile(name: string): string {
  return path.join(DATA_DIR, name);
}
