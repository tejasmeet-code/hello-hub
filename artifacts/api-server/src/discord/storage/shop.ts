import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "shop";
const FILE = () => dataFile("shop.json");

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShopEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface ShopEmbedConfig {
  title?: string;
  description?: string;
  thumbnail?: string;
  image?: string;
  color?: number;
  footer?: string;
  fields?: ShopEmbedField[];
}

export type ShopStatus = "active" | "coming_soon" | "out_of_stock";

export interface ShopMiniConfig {
  id: string;
  name: string;
  status?: ShopStatus;
  channelId?: string;
  categoryId?: string;
  messageId?: string;
  questions: string[];
  embed: ShopEmbedConfig;
}

export interface GuildShopSettings {
  enabled: boolean;
  modRoleIds: string[];
  adminRoleIds: string[];
  logChannelId?: string;
  transcriptChannelId?: string;
  proofChannelId?: string;
  customerRoleId?: string;
  shops: Record<string, ShopMiniConfig>;
  ticketCounter: number;
}

interface ShopStore {
  [guildId: string]: GuildShopSettings;
}

// ── Internal ─────────────────────────────────────────────────────────────────

let cache: ShopStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function defaultSettings(): GuildShopSettings {
  return {
    enabled: false,
    modRoleIds: [],
    adminRoleIds: [],
    shops: {},
    ticketCounter: 0,
  };
}

async function load(): Promise<ShopStore> {
  if (cache) return cache;
  cache = await loadPersistentJson<ShopStore>(STORE, FILE(), {});
  return cache;
}

async function save(data: ShopStore): Promise<void> {
  cache = data;
  writeQueue = writeQueue.then(() => persistPersistentJson(STORE, FILE(), data));
  return writeQueue;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getShopSettings(guildId: string): Promise<GuildShopSettings> {
  const store = await load();
  return store[guildId] ?? defaultSettings();
}

export async function updateShopSettings(
  guildId: string,
  mutator: (s: GuildShopSettings) => GuildShopSettings,
): Promise<GuildShopSettings> {
  const store = await load();
  const current = store[guildId] ?? defaultSettings();
  const updated = mutator({ ...current, shops: { ...current.shops } });
  store[guildId] = updated;
  await save(store);
  return updated;
}

export function generateShopId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function sanitizeForChannel(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 20);
}