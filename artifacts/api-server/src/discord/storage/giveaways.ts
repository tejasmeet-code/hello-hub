import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export interface Giveaway {
  giveawayId: string;
  guildId: string;
  channelId: string;
  messageId: string;
  prize: string;
  winnerCount: number;
  hostId: string;
  endsAt: number;
  ended: boolean;
  winnerIds: string[];
  requiredRoleId?: string;
  bonusRoleId?: string;
  bonusEntries?: number;
  description?: string;
}

const FILE_PATH = dataFile("giveaways.json");
let cache: Record<string, Giveaway> | null = null; // keyed by giveawayId
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, Giveaway>> {
  if (cache) return cache;
  cache = await loadPersistentJson("giveaways.json", FILE_PATH, {});
  return cache;
}

async function persist(data: Record<string, Giveaway>): Promise<void> {
  await persistPersistentJson("giveaways.json", FILE_PATH, data);
}

function queueWrite(data: Record<string, Giveaway>): void {
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
}

export async function createGiveaway(g: Giveaway): Promise<void> {
  const data = await load();
  data[g.giveawayId] = g;
  queueWrite(data);
}

export async function getGiveaway(id: string): Promise<Giveaway | null> {
  const data = await load();
  return data[id] ?? null;
}

export async function getGiveawayByMessage(messageId: string): Promise<Giveaway | null> {
  const data = await load();
  return Object.values(data).find((g) => g.messageId === messageId) ?? null;
}

export async function getActiveGiveaways(guildId?: string): Promise<Giveaway[]> {
  const data = await load();
  return Object.values(data).filter(
    (g) => !g.ended && (!guildId || g.guildId === guildId),
  );
}

export async function getGuildGiveaways(guildId: string): Promise<Giveaway[]> {
  const data = await load();
  return Object.values(data)
    .filter((g) => g.guildId === guildId)
    .sort((a, b) => b.endsAt - a.endsAt)
    .slice(0, 25);
}

export async function updateGiveaway(id: string, fn: (g: Giveaway) => Giveaway): Promise<Giveaway | null> {
  const data = await load();
  if (!data[id]) return null;
  data[id] = fn(data[id]!);
  queueWrite(data);
  return data[id]!;
}

export async function deleteGiveaway(id: string): Promise<void> {
  const data = await load();
  delete data[id];
  queueWrite(data);
}
