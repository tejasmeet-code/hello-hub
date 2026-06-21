import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export type AutomodAction = "delete" | "warn" | "mute" | "kick" | "ban";

export interface AutomodBaseRule {
  enabled: boolean;
  action: AutomodAction;
  muteDurationMinutes: number;
  exemptRoleIds: string[];
  exemptChannelIds: string[];
}

export interface SpamRule extends AutomodBaseRule {
  threshold: number;      // messages within windowSeconds
  windowSeconds: number;
}

export interface BadWordsRule extends AutomodBaseRule {
  words: string[];
}

export interface LinksRule extends AutomodBaseRule {
  whitelist: string[];    // allowed domains
}

export interface CapsRule extends AutomodBaseRule {
  percent: number;        // 0-100, e.g. 70 = 70% caps triggers
  minLength: number;      // ignore messages shorter than this
}

export interface MentionsRule extends AutomodBaseRule {
  threshold: number;      // how many @mentions triggers
}

export interface DuplicateRule extends AutomodBaseRule {
  windowSeconds: number;  // same message within this window
}

export interface NewlinesRule extends AutomodBaseRule {
  threshold: number;      // more than N newlines
}


export interface AiAutomodRule extends AutomodBaseRule {
  whitelist: string[];          // words to ignore during AI scan
  categories: string[];         // which categories to flag: "hate_speech"|"threat"|"harassment"|"slur"|"explicit"|"self_harm"
  minConfidence: number;        // 0-100, default 75
}
export interface AutomodConfig {
  enabled: boolean;
  logChannelId?: string;
  spam: SpamRule;
  badWords: BadWordsRule;
  links: LinksRule;
  invites: AutomodBaseRule;
  caps: CapsRule;
  mentions: MentionsRule;
  duplicates: DuplicateRule;
  newlines: NewlinesRule;
  aiAutomod: AiAutomodRule;
}

export function defaultAutomodConfig(): AutomodConfig {
  const baseRule: AutomodBaseRule = {
    enabled: false,
    action: "delete",
    muteDurationMinutes: 10,
    exemptRoleIds: [],
    exemptChannelIds: [],
  };
  return {
    enabled: false,
    spam: { ...baseRule, threshold: 5, windowSeconds: 5 },
    badWords: { ...baseRule, words: [] },
    links: { ...baseRule, whitelist: [] },
    invites: { ...baseRule },
    caps: { ...baseRule, percent: 70, minLength: 15 },
    mentions: { ...baseRule, threshold: 5 },
    duplicates: { ...baseRule, windowSeconds: 30 },
    newlines: { ...baseRule, threshold: 10 },
    aiAutomod: { ...baseRule, whitelist: [], categories: ["threat","hate_speech","slur"], minConfidence: 75 },
  };
}

const FILE_PATH = dataFile("automod.json");
let cache: Record<string, AutomodConfig> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, AutomodConfig>> {
  if (cache) return cache;
  cache = await loadPersistentJson("automod.json", FILE_PATH, {});
  return cache;
}

async function persist(data: Record<string, AutomodConfig>): Promise<void> {
  await persistPersistentJson("automod.json", FILE_PATH, data);
}

export async function getAutomodConfig(guildId: string): Promise<AutomodConfig> {
  const data = await load();
  const def = defaultAutomodConfig();
  const stored = data[guildId];
  if (!stored) return def;
  // Deep-merge: ensure fields added after initial save (e.g. aiAutomod) always have defaults
  return {
    ...def,
    ...stored,
    aiAutomod: { ...def.aiAutomod, ...(stored.aiAutomod ?? {}) },
  };
}

export async function updateAutomodConfig(
  guildId: string,
  fn: (c: AutomodConfig) => AutomodConfig,
): Promise<AutomodConfig> {
  const data = await load();
  if (!data[guildId]) data[guildId] = defaultAutomodConfig();
  data[guildId] = fn(data[guildId]!);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return data[guildId]!;
}

// ── Spam tracking (in-memory only, no persistence needed) ──────────────────

const spamMap = new Map<string, number[]>(); // `${guildId}:${userId}` -> timestamps
const duplicateMap = new Map<string, { msg: string; ts: number }>(); // `${guildId}:${userId}` -> last msg

export function recordSpam(guildId: string, userId: string): number {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const existing = spamMap.get(key) ?? [];
  const recent = existing.filter((t) => now - t < 10_000); // keep last 10s
  recent.push(now);
  spamMap.set(key, recent);
  return recent.length;
}

export function recordDuplicate(guildId: string, userId: string, msg: string): boolean {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const last = duplicateMap.get(key);
  duplicateMap.set(key, { msg, ts: now });
  if (!last) return false;
  return last.msg === msg && now - last.ts < 60_000;
}
