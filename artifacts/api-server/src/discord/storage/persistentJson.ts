import { promises as fs } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { DATA_DIR } from "../../lib/paths";
import { logger } from "../../lib/logger";

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];

const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: false },
        realtime: { transport: ws as any },
      })
    : null;

export function hasPersistentSupabaseStore(): boolean {
  return Boolean(supabase);
}

async function readLocalJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeLocalJson<T>(filePath: string, data: T): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function writeSupabaseJson<T>(storeName: string, data: T): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from("bot_json_store")
    .upsert(
      {
        store_name: storeName,
        payload: data,
      },
      { onConflict: "store_name" },
    );

  if (error) {
    logger.warn({ error, storeName }, "Persistent JSON store write failed");
    throw error;
  }
}

export async function loadPersistentJson<T>(
  storeName: string,
  filePath: string,
  fallback: T,
): Promise<T> {
  if (!supabase) {
    return readLocalJson(filePath, fallback);
  }

  try {
    const { data, error } = await supabase
      .from("bot_json_store")
      .select("payload")
      .eq("store_name", storeName)
      .maybeSingle();

    if (error) throw error;
    if (data?.payload != null) {
      return data.payload as T;
    }
  } catch (err) {
    logger.warn({ err, storeName }, "Persistent JSON store read failed; falling back to local file");
  }

  const local = await readLocalJson(filePath, fallback);

  try {
    await writeSupabaseJson(storeName, local);
  } catch {
    // Best-effort backfill only.
  }

  return local;
}

export async function persistPersistentJson<T>(
  storeName: string,
  filePath: string,
  data: T,
): Promise<void> {
  await writeLocalJson(filePath, data);

  if (!supabase) {
    return;
  }

  try {
    await writeSupabaseJson(storeName, data);
  } catch (err) {
    logger.warn({ err, storeName }, "Persistent JSON store write failed; local file saved");
  }
}