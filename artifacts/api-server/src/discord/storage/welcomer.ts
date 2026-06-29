import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export interface WelcomerEmbedConfig {
  title?: string;
  description?: string;
  color?: number;
  imageUrl?: string;
  thumbnailUrl?: string;
  footer?: string;
  showAvatar?: boolean;
}

export interface WelcomerChannelConfig {
  enabled: boolean;
  channelId?: string;
  mode: "embed" | "image" | "text";
  message?: string;
  embed?: WelcomerEmbedConfig;
  imageBackground?: number | string;
  aboveText?: string;
}

export interface WelcomerDmConfig {
  enabled: boolean;
  mode: "embed" | "text";
  message?: string;
  embed?: WelcomerEmbedConfig;
  aboveText?: string;
}

export interface WelcomerConfig {
  enabled: boolean;
  channel: WelcomerChannelConfig;
  dm: WelcomerDmConfig;
}

type WelcomerStore = Record<string, WelcomerConfig>;

const FILE_PATH = dataFile("welcomer.json");

let cache: WelcomerStore | null = null;

async function load(): Promise<WelcomerStore> {
  if (!cache) {
    cache = await loadPersistentJson("welcomer.json", FILE_PATH, {});
  }
  return cache;
}

async function save(store: WelcomerStore): Promise<void> {
  cache = store;
  await persistPersistentJson("welcomer.json", FILE_PATH, store);
}

function defaultConfig(): WelcomerConfig {
  return {
    enabled: false,
    channel: {
      enabled: false,
      mode: "embed",
      embed: {
        title: "Welcome to {server}!",
        description: "Hey {user}, welcome to **{server}**! You are our **{ordinal}** member 🎉",
        color: 0x2b2d31,
        showAvatar: true,
        footer: "{server} • {count} members",
      },
    },
    dm: {
      enabled: false,
      mode: "text",
      message: "Welcome to **{server}**, {username}! We're glad to have you 🎉",
    },
  };
}

export async function getWelcomerConfig(guildId: string): Promise<WelcomerConfig> {
  const store = await load();
  return store[guildId] ?? defaultConfig();
}

export async function updateWelcomerConfig(
  guildId: string,
  updater: (cfg: WelcomerConfig) => void,
): Promise<WelcomerConfig> {
  const store = await load();
  const cfg = store[guildId] ?? defaultConfig();
  updater(cfg);
  store[guildId] = cfg;
  await save(store);
  return cfg;
}
