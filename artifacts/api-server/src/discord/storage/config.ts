import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export type FailureAction = "none" | "warning" | "strike" | "demotion" | "termination";

export interface GuildManagers {
  roleIds: string[];
  userIds: string[];
}

export interface GuildModules {
  staffMgmt: boolean;
  quota: boolean;
  auditLog: boolean;
  moderation: boolean;
  infractions: boolean;
  appeals: boolean;
  loa: boolean;
  partnership: boolean;
  verify: boolean;
  banRequest: boolean;
  roleMemory: boolean;
  antiNuke: boolean;
  serverMaintenance: boolean;
  automations?: boolean;
  staffDirectory?: boolean;
  afk?: boolean;
  noPrefix?: boolean;
}

export interface GuildChannels {
  promotions?: string;
  demotions?: string;
  botNotifications?: string;
  performance?: string;
  moderation?: string;
  infractions?: string;
  appeals?: string;
  loaLog?: string;
  staffReport?: string;
  partnershipCheck?: string;
  partnership?: string;
  verifyChannel?: string;
  banRequest?: string;
  antiNukeLog?: string;
  staffLog?: string;
  quotaLog?: string;
  roleMemoryLog?: string;
  staffDirectoryLog?: string;
  staffFeedbackLog?: string;
}

export interface StaffReportState {
  channelId: string;
  messageId: string;
  lastUpdated?: number;
}

export interface QuotaConfig {
  messages: number;
  modActions: number;
  weekStartDay: number;
}

export interface RoleQuota {
  messages: number;
  modActions: number;
}

// ── Per-module custom settings ──────────────────────────────────────────────

export interface InfractionsConfig {
  strikeExpiryDays: number;
  dmOnInfraction: boolean;
  autoDemotionEnabled: boolean;
  strikeAction1: FailureAction;
  strikeAction2: FailureAction;
  strikeAction3plus: FailureAction;
}

export interface QuotaFailureConfig {
  failure1: FailureAction;
  failure2: FailureAction;
  failure3plus: FailureAction;
}

export interface ModerationConfig {
  dmOnAction: boolean;
}

export interface PromotionsConfig {
  dmMember: boolean;
}

export interface DemotionsConfig {
  dmMember: boolean;
}

export interface AppealsConfig {
  autoCloseDays: number;
}

export interface LoaConfig {
  maxDurationDays: number;
  requireReason: boolean;
}

export interface StaffReportConfig {
  refreshIntervalHours: number;
}

// ── Maintenance module ────────────────────────────────────────────────────────

/** Snapshot of a channel's ViewChannel overwrite for the members role before maintenance. */
export type ChannelPermSnap = { viewDenyBefore: boolean } | null;

export interface MaintenanceModuleConfig {
  categoryId?: string;
  announcementsChannelId?: string;
  chatChannelId?: string;
  mediaChannelId?: string;
  cmdsChannelId?: string;
  /** The regular members role whose channel view permissions are locked during maintenance. */
  membersRoleId?: string;
  active?: boolean;
  /** Snapshot of channel permission states taken at maintenance start, keyed by channelId. */
  savedPerms?: Record<string, ChannelPermSnap>;
  /** Mode for maintenance start announcement: 'embed', 'text', or 'embed_text'. */
  announceMode?: "embed" | "text" | "embed_text";
  /** Custom text content for the announcement. */
  announceText?: string;
  /** Custom embed title. */
  announceEmbedTitle?: string;
  /** Custom embed description. */
  announceEmbedDescription?: string;
}

// ── Anti-Nuke types ─────────────────────────────────────────────────────────

export type AntiNukePunishment = "none" | "kick" | "ban" | "timeout_1h" | "timeout_24h" | "timeout_7d";
export type AntiNukeMiniId = "antiJoin" | "antiBan" | "antiKick" | "antiRole" | "antiChannel";

export interface AntiNukeMiniModuleConfig {
  enabled: boolean;
  whitelistUserIds: string[];
  whitelistRoleIds: string[];
  punishment: AntiNukePunishment;
}

export interface AntiJoinConfig extends AntiNukeMiniModuleConfig {
  threshold: number;
  windowSeconds: number;
}

export interface AntiNukeConfig {
  enabled: boolean;
  accessUserIds: string[];
  globalWhitelistUserIds: string[];
  globalWhitelistRoleIds: string[];
  globalWhitelistChannelIds: string[];
  globalWhitelistCategoryIds: string[];
  commonPunishment: AntiNukePunishment;
  antiJoin: AntiJoinConfig;
  antiBan: AntiNukeMiniModuleConfig;
  antiKick: AntiNukeMiniModuleConfig;
  antiRole: AntiNukeMiniModuleConfig;
  antiChannel: AntiNukeMiniModuleConfig;
}

// ── Main config type ────────────────────────────────────────────────────────

export interface PartnershipConfig {
  quota: number;
  failureActions: {
    1: FailureAction;
    2: FailureAction;
    3: FailureAction;
  };
}

export interface VerifyConfig {
  rolesToAssign: string[];
  useModal: boolean;
  customMessage?: string;
}

export interface GuildConfig {
  managers: GuildManagers;
  modules: GuildModules;
  channels: GuildChannels;
  moduleRoles?: Record<string, string[]>;
  roleQuotas?: Record<string, RoleQuota>;
  quotaWhitelistRoles?: string[];
  quotaConfig?: QuotaConfig;
  staffReportState?: StaffReportState;
  appealServerInvite?: string;
  partnershipConfig?: PartnershipConfig;
  verifyConfig?: VerifyConfig;
  antiNukeConfig?: AntiNukeConfig;
  maintenanceConfig?: MaintenanceModuleConfig;
  commandsUnlocked?: boolean;
  guildPrefix?: string;
  infractionsConfig?: InfractionsConfig;
  moderationConfig?: ModerationConfig;
  promotionsConfig?: PromotionsConfig;
  demotionsConfig?: DemotionsConfig;
  appealsConfig?: AppealsConfig;
  loaConfig?: LoaConfig;
  staffReportConfig?: StaffReportConfig;
  quotaFailureConfig?: QuotaFailureConfig;
  setupWizardCompleted?: boolean;
  setupConfig?: {
    mainRoleId?: string;
    staffCommonRoleId?: string;
    staffRoleHierarchy?: string[];
  };
  autoReactMappings?: Array<{
    id: string;
    targetType: "user" | "channel" | "category";
    targetId: string;
    emoji: string;
  }>;
  noPrefixUserIds?: string[];
  noPrefixRoles?: string[];
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS: GuildConfig = {
  managers: { roleIds: [], userIds: [] },
  modules: {
    staffMgmt: true, quota: true, auditLog: true, moderation: true,
    infractions: true, appeals: true, loa: true, partnership: true,
    verify: true, banRequest: true, roleMemory: true, antiNuke: false,
    serverMaintenance: false, staffDirectory: false, afk: true, noPrefix: true,
  },
  channels: {},
  moduleRoles: {},
};

// ── Per-module getters with fallback defaults ────────────────────────────────

export function getInfractionsConfig(cfg: GuildConfig): Required<InfractionsConfig> {
  return {
    strikeExpiryDays:    cfg.infractionsConfig?.strikeExpiryDays    ?? 30,
    dmOnInfraction:      cfg.infractionsConfig?.dmOnInfraction       ?? true,
    autoDemotionEnabled: cfg.infractionsConfig?.autoDemotionEnabled  ?? true,
    strikeAction1:       cfg.infractionsConfig?.strikeAction1        ?? "warning",
    strikeAction2:       cfg.infractionsConfig?.strikeAction2        ?? "strike",
    strikeAction3plus:   cfg.infractionsConfig?.strikeAction3plus    ?? "termination",
  };
}

export function getQuotaFailureConfig(cfg: GuildConfig): Required<QuotaFailureConfig> {
  return {
    failure1:     cfg.quotaFailureConfig?.failure1     ?? "warning",
    failure2:     cfg.quotaFailureConfig?.failure2     ?? "strike",
    failure3plus: cfg.quotaFailureConfig?.failure3plus ?? "termination",
  };
}

export function getModerationConfig(cfg: GuildConfig): Required<ModerationConfig> {
  return { dmOnAction: cfg.moderationConfig?.dmOnAction ?? true };
}

export function getPromotionsConfig(cfg: GuildConfig): Required<PromotionsConfig> {
  return { dmMember: cfg.promotionsConfig?.dmMember ?? true };
}

export function getDemotionsConfig(cfg: GuildConfig): Required<DemotionsConfig> {
  return { dmMember: cfg.demotionsConfig?.dmMember ?? true };
}

export function getAppealsConfig(cfg: GuildConfig): Required<AppealsConfig> {
  return { autoCloseDays: cfg.appealsConfig?.autoCloseDays ?? 0 };
}

export function getLoaConfig(cfg: GuildConfig): Required<LoaConfig> {
  return {
    maxDurationDays: cfg.loaConfig?.maxDurationDays ?? 0,
    requireReason:   cfg.loaConfig?.requireReason   ?? true,
  };
}

export function getPartnershipConfig(cfg: GuildConfig): Required<PartnershipConfig> {
  return {
    quota: cfg.partnershipConfig?.quota ?? 0,
    failureActions: {
      1: cfg.partnershipConfig?.failureActions?.[1] ?? "none",
      2: cfg.partnershipConfig?.failureActions?.[2] ?? "none",
      3: cfg.partnershipConfig?.failureActions?.[3] ?? "none",
    },
  };
}

export function getStaffReportConfig(cfg: GuildConfig): Required<StaffReportConfig> {
  return { refreshIntervalHours: cfg.staffReportConfig?.refreshIntervalHours ?? 2 };
}

export function getAntiNukeConfig(cfg: GuildConfig): AntiNukeConfig {
  const an: Partial<AntiNukeConfig> = cfg.antiNukeConfig ?? {};
  const defaultMini: AntiNukeMiniModuleConfig = {
    enabled: false,
    whitelistUserIds: [],
    whitelistRoleIds: [],
    punishment: "none",
  };
  return {
    enabled: an.enabled ?? false,
    accessUserIds: an.accessUserIds ?? [],
    globalWhitelistUserIds: an.globalWhitelistUserIds ?? [],
    globalWhitelistRoleIds: an.globalWhitelistRoleIds ?? [],
    globalWhitelistChannelIds: an.globalWhitelistChannelIds ?? [],
    globalWhitelistCategoryIds: an.globalWhitelistCategoryIds ?? [],
    commonPunishment: an.commonPunishment ?? "none",
    antiJoin: {
      ...defaultMini,
      threshold: 3,
      windowSeconds: 60,
      ...(an.antiJoin ?? {}),
    },
    antiBan:     { ...defaultMini, ...(an.antiBan ?? {}) },
    antiKick:    { ...defaultMini, ...(an.antiKick ?? {}) },
    antiRole:    { ...defaultMini, ...(an.antiRole ?? {}) },
    antiChannel: { ...defaultMini, ...(an.antiChannel ?? {}) },
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

const FILE_PATH = dataFile("config.json");

let cache: Record<string, GuildConfig> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, GuildConfig>> {
  if (cache) return cache;
  cache = await loadPersistentJson("config.json", FILE_PATH, {});
  return cache;
}

async function persist(data: Record<string, GuildConfig>): Promise<void> {
  await persistPersistentJson("config.json", FILE_PATH, data);
}

function withDefaults(c: Partial<GuildConfig> | undefined): GuildConfig {
  return {
    managers: {
      roleIds: c?.managers?.roleIds ?? [],
      userIds: c?.managers?.userIds ?? [],
    },
    modules: {
      staffMgmt:         c?.modules?.staffMgmt         ?? true,
      quota:             c?.modules?.quota             ?? true,
      auditLog:          c?.modules?.auditLog          ?? true,
      moderation:        c?.modules?.moderation        ?? true,
      infractions:       c?.modules?.infractions       ?? true,
      appeals:           c?.modules?.appeals           ?? true,
      loa:               c?.modules?.loa               ?? true,
      partnership:       c?.modules?.partnership       ?? true,
      verify:            c?.modules?.verify            ?? true,
      banRequest:        c?.modules?.banRequest        ?? true,
      roleMemory:        c?.modules?.roleMemory        ?? true,
      antiNuke:          c?.modules?.antiNuke          ?? false,
      serverMaintenance: c?.modules?.serverMaintenance ?? false,
      staffDirectory:    c?.modules?.staffDirectory    ?? false,
    },
    channels: { ...(c?.channels ?? {}) },
    moduleRoles:         { ...(c?.moduleRoles ?? {}) },
    roleQuotas:          { ...(c?.roleQuotas ?? {}) },
    quotaWhitelistRoles: [...(c?.quotaWhitelistRoles ?? [])],
    quotaConfig:         c?.quotaConfig,
    staffReportState:    c?.staffReportState,
    appealServerInvite:  c?.appealServerInvite,
    guildPrefix:         c?.guildPrefix,
    commandsUnlocked:    c?.commandsUnlocked,
    maintenanceConfig:   c?.maintenanceConfig,
    infractionsConfig:   c?.infractionsConfig,
    moderationConfig:    c?.moderationConfig,
    promotionsConfig:    c?.promotionsConfig,
    demotionsConfig:     c?.demotionsConfig,
    appealsConfig:       c?.appealsConfig,
    loaConfig:           c?.loaConfig,
    staffReportConfig:   c?.staffReportConfig,
    partnershipConfig:   c?.partnershipConfig,
    quotaFailureConfig:  c?.quotaFailureConfig,
    antiNukeConfig:      c?.antiNukeConfig,
    setupWizardCompleted: c?.setupWizardCompleted,
    setupConfig:         c?.setupConfig,
    autoReactMappings:   c?.autoReactMappings,
  };
}

// ── Staff report helpers ─────────────────────────────────────────────────────

export async function setStaffReportChannel(guildId: string, channelId: string): Promise<GuildConfig> {
  return updateGuildConfig(guildId, (c) => ({
    ...c,
    channels: { ...c.channels, staffReport: channelId },
  }));
}

export async function clearStaffReportChannel(guildId: string): Promise<GuildConfig> {
  return updateGuildConfig(guildId, (c) => {
    const next = { ...c, channels: { ...c.channels } };
    delete next.channels.staffReport;
    delete next.staffReportState;
    return next;
  });
}

export async function setStaffReportState(
  guildId: string,
  state: StaffReportState | undefined,
): Promise<GuildConfig> {
  return updateGuildConfig(guildId, (c) => {
    const next = { ...c };
    if (state) next.staffReportState = state;
    else delete next.staffReportState;
    return next;
  });
}

export async function listGuildsWithStaffReportChannel(): Promise<{ guildId: string; channelId: string }[]> {
  const data = await load();
  const out: { guildId: string; channelId: string }[] = [];
  for (const [guildId, cfg] of Object.entries(data)) {
    const ch = cfg.channels?.staffReport;
    if (ch) out.push({ guildId, channelId: ch });
  }
  return out;
}

// ── Core CRUD ───────────────────────────────────────────────────────────────

export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
  const data = await load();
  return withDefaults(data[guildId]);
}

export async function updateGuildConfig(
  guildId: string,
  mutator: (c: GuildConfig) => GuildConfig,
): Promise<GuildConfig> {
  const data = await load();
  const current = withDefaults(data[guildId]);
  const next = mutator(current);
  data[guildId] = next;
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return next;
}

export { DEFAULTS as DEFAULT_GUILD_CONFIG };
