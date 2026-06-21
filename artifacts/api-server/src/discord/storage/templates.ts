/**
 * Dev-only server config templates.
 * Templates capture the "transferable" parts of a guild's config (modules +
 * per-module settings, no channels/roles/managers). Only global perm-whitelist
 * users can save, delete, or apply templates.
 */
import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";
import type {
  GuildModules,
  QuotaConfig,
  InfractionsConfig,
  ModerationConfig,
  PromotionsConfig,
  DemotionsConfig,
  AppealsConfig,
  LoaConfig,
  StaffReportConfig,
  QuotaFailureConfig,
  PartnershipConfig,
  AntiNukeConfig,
} from "./config";

// ── Transferable config shape ─────────────────────────────────────────────────

export interface TransferableConfig {
  modules: GuildModules;
  guildPrefix?: string;
  quotaConfig?: QuotaConfig;
  infractionsConfig?: InfractionsConfig;
  moderationConfig?: ModerationConfig;
  promotionsConfig?: PromotionsConfig;
  demotionsConfig?: DemotionsConfig;
  appealsConfig?: AppealsConfig;
  loaConfig?: LoaConfig;
  staffReportConfig?: StaffReportConfig;
  quotaFailureConfig?: QuotaFailureConfig;
  partnershipConfig?: PartnershipConfig;
  antiNukeConfig?: AntiNukeConfig;
}

// ── Template record ───────────────────────────────────────────────────────────

export interface ConfigTemplate {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: number;
  sourceGuildId: string;
  config: TransferableConfig;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const FILE = () => dataFile("templates.json");
let cache: Record<string, ConfigTemplate> | null = null;
let wq: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, ConfigTemplate>> {
  if (cache) return cache;
  cache = await loadPersistentJson<Record<string, ConfigTemplate>>("templates", FILE(), {});
  return cache;
}

function persist(data: Record<string, ConfigTemplate>): void {
  wq = wq.then(() => persistPersistentJson("templates", FILE(), data)).catch(() => {});
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function saveTemplate(t: Omit<ConfigTemplate, "id"> & { id?: string }): Promise<ConfigTemplate> {
  const data = await load();
  const id = t.id ?? `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const template: ConfigTemplate = { ...t, id };
  data[id] = template;
  persist(data);
  return template;
}

export async function listTemplates(): Promise<ConfigTemplate[]> {
  const data = await load();
  return Object.values(data).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getTemplate(id: string): Promise<ConfigTemplate | null> {
  const data = await load();
  return data[id] ?? null;
}

export async function findTemplateByName(name: string): Promise<ConfigTemplate | null> {
  const data = await load();
  const lower = name.toLowerCase();
  return Object.values(data).find((t) => t.name.toLowerCase() === lower) ?? null;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const data = await load();
  if (!data[id]) return false;
  delete data[id];
  persist(data);
  return true;
}
