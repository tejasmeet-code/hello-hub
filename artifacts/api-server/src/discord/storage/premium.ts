import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "premium_store";
const FILE = () => dataFile("premium_store.json");

export const BOT_ADMIN_IDS = new Set<string>([
  "1181221352393420856",
  "1384512046200127570",
  "867277178684178453",
  "1466728565352435847",
  "1414620491544658021",
  "1209755174420221984",
]);

export function isBotAdmin(userId: string): boolean {
  if (BOT_ADMIN_IDS.has(userId)) return true;
  if (process.env.DISCORD_OWNER_ID && process.env.DISCORD_OWNER_ID.split(",").includes(userId)) {
    return true;
  }
  return false;
}

export interface PremiumCode {
  code: string;
  codeType: "user" | "server";
  durationDays: number;
  guildLimit: number;
  redeemedCount: number;
  createdAt: number;
}

interface PremiumStore {
  codes: Record<string, PremiumCode>;
  userPremiums: Record<string, number>;
  guildPremiums: Record<string, number>;
}

let cache: PremiumStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<PremiumStore> {
  if (cache) return cache;
  cache = await loadPersistentJson<PremiumStore>(STORE, FILE(), {
    codes: {},
    userPremiums: {},
    guildPremiums: {},
  });
  return cache;
}

async function save(store: PremiumStore): Promise<void> {
  cache = store;
  writeQueue = writeQueue.then(() => persistPersistentJson(STORE, FILE(), store));
  return writeQueue;
}

export async function createPremiumCode(
  code: string,
  codeType: "user" | "server",
  durationDays: number,
  guildLimit = 1,
): Promise<PremiumCode> {
  const store = await load();
  const entry: PremiumCode = {
    code: code.toUpperCase(),
    codeType,
    durationDays,
    guildLimit: Math.max(1, guildLimit),
    redeemedCount: 0,
    createdAt: Date.now(),
  };
  store.codes[entry.code] = entry;
  await save(store);
  return entry;
}

export async function redeemPremiumCode(
  codeString: string,
  targetId: string,
  targetType: "user" | "server",
): Promise<{ success: boolean; message: string; expiresAt?: number }> {
  const store = await load();
  const code = store.codes[codeString.toUpperCase()];
  if (!code) {
    return { success: false, message: "Invalid premium license code." };
  }
  if (code.codeType !== targetType) {
    return {
      success: false,
      message: `This code is intended for ${code.codeType} premium activation, but was redeemed for a ${targetType}.`,
    };
  }
  if (code.redeemedCount >= code.guildLimit) {
    return {
      success: false,
      message: "This premium license code has already reached its redemption quota limit.",
    };
  }

  const durationMs = code.durationDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let newExpiry: number;

  if (targetType === "user") {
    const existing = store.userPremiums[targetId] ?? now;
    newExpiry = Math.max(now, existing) + durationMs;
    store.userPremiums[targetId] = newExpiry;
  } else {
    const existing = store.guildPremiums[targetId] ?? now;
    newExpiry = Math.max(now, existing) + durationMs;
    store.guildPremiums[targetId] = newExpiry;
  }

  code.redeemedCount += 1;
  await save(store);
  return {
    success: true,
    message: `Premium activated successfully until <t:${Math.floor(newExpiry / 1000)}:F>.`,
    expiresAt: newExpiry,
  };
}

export async function isUserPremium(userId: string): Promise<boolean> {
  if (isBotAdmin(userId)) return true;
  const store = await load();
  const expiry = store.userPremiums[userId];
  if (!expiry) return false;
  if (Date.now() > expiry) {
    delete store.userPremiums[userId];
    await save(store);
    return false;
  }
  return true;
}

export async function isGuildPremium(guildId: string): Promise<boolean> {
  const store = await load();
  const expiry = store.guildPremiums[guildId];
  if (!expiry) return false;
  if (Date.now() > expiry) {
    delete store.guildPremiums[guildId];
    await save(store);
    return false;
  }
  return true;
}

export async function hasPremiumAccess(userId: string, guildId?: string | null): Promise<boolean> {
  if (isBotAdmin(userId)) return true;
  if (await isUserPremium(userId)) return true;
  if (guildId && (await isGuildPremium(guildId))) return true;
  return false;
}
