import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export interface LevelRole {
  level: number;
  roleId: string;
}

export interface LevelConfig {
  enabled: boolean;
  xpPerMessageMin: number;
  xpPerMessageMax: number;
  xpCooldownSeconds: number;
  xpPerVcMinute: number;
  allowedChannels: string[];
  ignoredChannels: string[];
  ignoredRoles: string[];
  levelUpChannel: string | null;
  levelUpAnnounce: boolean;
  levelLimit: number | null;
  stackRoles: boolean;
  levelRoles: LevelRole[];
  embedColor: number;
  embedMessage: string;
}

export interface MemberLevelData {
  xp: number;
  level: number;
  totalXp: number;
  lastMessageXp: number;
}

const CONFIGS_FILE = dataFile("levels.json");
const MEMBERS_FILE = dataFile("levels-members.json");

let configCache: Record<string, LevelConfig> | null = null;
let memberCache: Record<string, MemberLevelData> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let memberWriteQueue: Promise<void> = Promise.resolve();

const DEFAULT_CONFIG: LevelConfig = {
  enabled: false,
  xpPerMessageMin: 15,
  xpPerMessageMax: 25,
  xpCooldownSeconds: 60,
  xpPerVcMinute: 5,
  allowedChannels: [],
  ignoredChannels: [],
  ignoredRoles: [],
  levelUpChannel: null,
  levelUpAnnounce: true,
  levelLimit: null,
  stackRoles: true,
  levelRoles: [],
  embedColor: 0x5865f2,
  embedMessage: "{user} leveled up to **Level {level}**! Keep chatting to grow! 🎉",
};

async function loadConfigs(): Promise<Record<string, LevelConfig>> {
  if (configCache) return configCache;
  configCache = await loadPersistentJson("levels.json", CONFIGS_FILE, {});
  return configCache;
}

async function persistConfigs(data: Record<string, LevelConfig>): Promise<void> {
  await persistPersistentJson("levels.json", CONFIGS_FILE, data);
}

export async function getLevelConfig(guildId: string): Promise<LevelConfig> {
  const data = await loadConfigs();
  return { ...DEFAULT_CONFIG, ...(data[guildId] ?? {}) };
}

export async function updateLevelConfig(
  guildId: string,
  mutator: (c: LevelConfig) => LevelConfig,
): Promise<LevelConfig> {
  const data = await loadConfigs();
  const current: LevelConfig = { ...DEFAULT_CONFIG, ...(data[guildId] ?? {}) };
  const next = mutator(current);
  data[guildId] = next;
  writeQueue = writeQueue.then(() => persistConfigs(data)).catch(() => {});
  await writeQueue;
  return next;
}

async function loadMembers(): Promise<Record<string, MemberLevelData>> {
  if (memberCache) return memberCache;
  memberCache = await loadPersistentJson("levels-members.json", MEMBERS_FILE, {});
  return memberCache;
}

async function persistMembers(data: Record<string, MemberLevelData>): Promise<void> {
  await persistPersistentJson("levels-members.json", MEMBERS_FILE, data);
}

function memberKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export async function getMemberLevel(guildId: string, userId: string): Promise<MemberLevelData> {
  const data = await loadMembers();
  return data[memberKey(guildId, userId)] ?? { xp: 0, level: 0, totalXp: 0, lastMessageXp: 0 };
}

export async function setMemberLevel(
  guildId: string,
  userId: string,
  d: MemberLevelData,
): Promise<void> {
  const data = await loadMembers();
  data[memberKey(guildId, userId)] = d;
  memberCache = data;
  memberWriteQueue = memberWriteQueue.then(() => persistMembers(data)).catch(() => {});
  await memberWriteQueue;
}

export async function addMemberXp(
  guildId: string,
  userId: string,
  amount: number,
): Promise<{ data: MemberLevelData; oldLevel: number }> {
  const current = await getMemberLevel(guildId, userId);
  const { levelFromTotalXp, totalXpForLevel } = await import("../utils/levelCalc");
  const oldLevel = current.level;
  const newTotalXp = Math.max(0, current.totalXp + amount);
  const newLevel = levelFromTotalXp(newTotalXp);
  const newData: MemberLevelData = {
    xp: newTotalXp - totalXpForLevel(newLevel),
    level: newLevel,
    totalXp: newTotalXp,
    lastMessageXp: current.lastMessageXp,
  };
  await setMemberLevel(guildId, userId, newData);
  return { data: newData, oldLevel };
}

export async function setMemberLevelDirectly(
  guildId: string,
  userId: string,
  level: number,
): Promise<MemberLevelData> {
  const { totalXpForLevel } = await import("../utils/levelCalc");
  const totalXp = totalXpForLevel(level);
  const data: MemberLevelData = {
    xp: 0,
    level,
    totalXp,
    lastMessageXp: 0,
  };
  await setMemberLevel(guildId, userId, data);
  return data;
}

export async function getLeaderboard(
  guildId: string,
  limit = 10,
  offset = 0,
): Promise<Array<{ userId: string; data: MemberLevelData }>> {
  const data = await loadMembers();
  const prefix = `${guildId}:`;
  return Object.entries(data)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ userId: k.slice(prefix.length), data: v }))
    .sort((a, b) => b.data.totalXp - a.data.totalXp)
    .slice(offset, offset + limit);
}

export async function getLeaderboardRank(guildId: string, userId: string): Promise<number> {
  const data = await loadMembers();
  const prefix = `${guildId}:`;
  const sorted = Object.entries(data)
    .filter(([k]) => k.startsWith(prefix))
    .sort(([, a], [, b]) => b.totalXp - a.totalXp);
  const idx = sorted.findIndex(([k]) => k === `${guildId}:${userId}`);
  return idx === -1 ? -1 : idx + 1;
}

export async function getTotalMembersWithXp(guildId: string): Promise<number> {
  const data = await loadMembers();
  const prefix = `${guildId}:`;
  return Object.keys(data).filter((k) => k.startsWith(prefix)).length;
}
