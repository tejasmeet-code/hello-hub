import type { GuildMember } from "discord.js";
import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export interface StaffRoleEntry {
  roleId: string;
  position: number;
}

export type InfractionType = "warning" | "strike" | "demotion" | "termination";

export interface InfractionEntry {
  id: string;
  type: InfractionType;
  at: number;
  byUserId: string;
  reason: string;
  expiresAt?: number;
  expiryDmSent?: boolean;
}

export interface PromotionEntry {
  fromRoleId: string | null;
  toRoleId: string;
  at: number;
  byUserId: string;
  reason?: string;
}

export interface DemotionEntry {
  fromRoleId: string;
  toRoleId: string | null;
  at: number;
  byUserId: string;
  reason?: string;
}

export interface StaffProfile {
  userId: string;
  firstJoinedAt: number;
  currentRoleId: string | null;
  positionHistory: { roleId: string; fromAt: number; toAt: number | null }[];
  promotions: PromotionEntry[];
  demotions: DemotionEntry[];
  infractions: InfractionEntry[];
  terminated: boolean;
  terminatedAt?: number;
  partnershipScore: number;
  ratingSum?: number;
  ratingCount?: number;
  feedbackCooldowns?: Record<string, number>;
}

export interface GuildStaff {
  roles: StaffRoleEntry[];
  profiles: Record<string, StaffProfile>;
}

const FILE_PATH = dataFile("staff.json");
let cache: Record<string, GuildStaff> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, GuildStaff>> {
  if (cache) return cache;
  cache = await loadPersistentJson("staff.json", FILE_PATH, {});
  return cache;
}

async function persist(data: Record<string, GuildStaff>): Promise<void> {
  await persistPersistentJson("staff.json", FILE_PATH, data);
}

function ensureGuild(data: Record<string, GuildStaff>, guildId: string): GuildStaff {
  if (!data[guildId]) data[guildId] = { roles: [], profiles: {} };
  return data[guildId];
}

function queueWrite(data: Record<string, GuildStaff>): Promise<void> {
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  return writeQueue;
}

function getHeldRoleEntry(roles: StaffRoleEntry[], member: GuildMember): StaffRoleEntry | null {
  const memberRoleIds = new Set(member.roles.cache.keys());
  let highest: StaffRoleEntry | null = null;
  for (const r of roles) {
    if (!memberRoleIds.has(r.roleId)) continue;
    if (!highest || r.position < highest.position) {
      highest = r;
    }
  }
  return highest;
}

export async function listStaffRoles(guildId: string): Promise<StaffRoleEntry[]> {
  const data = await load();
  const g = data[guildId];
  if (!g) return [];
  return [...g.roles].sort((a, b) => a.position - b.position);
}

export async function getRoleEntry(guildId: string, roleId: string): Promise<StaffRoleEntry | null> {
  const roles = await listStaffRoles(guildId);
  return roles.find((r) => r.roleId === roleId) ?? null;
}

export async function getHighestHeldStaffRole(guildId: string, member: GuildMember): Promise<StaffRoleEntry | null> {
  const roles = await listStaffRoles(guildId);
  return getHeldRoleEntry(roles, member);
}

export async function addStaffRole(guildId: string, roleId: string, position?: number): Promise<{ added: boolean; entry: StaffRoleEntry }> {
  const data = await load();
  const g = ensureGuild(data, guildId);
  const existing = g.roles.find((r) => r.roleId === roleId);
  if (existing) return { added: false, entry: existing };
  let pos: number;
  if (typeof position === "number" && position > 0) {
    pos = Math.floor(position);
    for (const r of g.roles) if (r.position >= pos) r.position += 1;
  } else {
    const max = g.roles.reduce((m, r) => Math.max(m, r.position), 0);
    pos = max + 1;
  }
  const entry: StaffRoleEntry = { roleId, position: pos };
  g.roles.push(entry);
  await queueWrite(data);
  return { added: true, entry };
}

export async function removeStaffRole(guildId: string, roleId: string): Promise<boolean> {
  const data = await load();
  const g = data[guildId];
  if (!g) return false;
  const idx = g.roles.findIndex((r) => r.roleId === roleId);
  if (idx === -1) return false;
  const removed = g.roles.splice(idx, 1)[0]!;
  for (const r of g.roles) if (r.position > removed.position) r.position -= 1;
  await queueWrite(data);
  return true;
}

export async function reorderStaffRole(guildId: string, roleId: string, newPosition: number): Promise<boolean> {
  const data = await load();
  const g = data[guildId];
  if (!g) return false;
  const r = g.roles.find((x) => x.roleId === roleId);
  if (!r) return false;
  const oldPos = r.position;
  if (newPosition === oldPos) return true;
  for (const other of g.roles) {
    if (other.roleId === roleId) continue;
    if (newPosition < oldPos && other.position >= newPosition && other.position < oldPos) other.position += 1;
    else if (newPosition > oldPos && other.position <= newPosition && other.position > oldPos) other.position -= 1;
  }
  r.position = newPosition;
  await queueWrite(data);
  return true;
}

export async function getProfile(guildId: string, userId: string): Promise<StaffProfile | null> {
  const data = await load();
  return data[guildId]?.profiles[userId] ?? null;
}

export async function listProfiles(guildId: string): Promise<StaffProfile[]> {
  const data = await load();
  const g = data[guildId];
  if (!g) return [];
  return Object.values(g.profiles);
}

function newProfile(userId: string, now: number): StaffProfile {
  return { userId, firstJoinedAt: now, currentRoleId: null, positionHistory: [], promotions: [], demotions: [], infractions: [], terminated: false, partnershipScore: 0, ratingSum: 0, ratingCount: 0, feedbackCooldowns: {} };
}

export async function syncProfileFromMember(guildId: string, member: GuildMember): Promise<{ created: boolean; changed: boolean; profile: StaffProfile | null }> {
  const data = await load();
  const g = ensureGuild(data, guildId);
  const roles = [...g.roles].sort((a, b) => a.position - b.position);
  if (member.user.bot) return { created: false, changed: false, profile: null };
  const held = getHeldRoleEntry(roles, member);
  const now = Date.now();
  const existing = g.profiles[member.id];
  if (!existing) {
    if (!held) return { created: false, changed: false, profile: null };
    const profile = newProfile(member.id, now);
    profile.currentRoleId = held.roleId;
    profile.positionHistory.push({ roleId: held.roleId, fromAt: now, toAt: null });
    g.profiles[member.id] = profile;
    await queueWrite(data);
    return { created: true, changed: true, profile };
  }
  if (existing.currentRoleId === (held?.roleId ?? null)) return { created: false, changed: false, profile: existing };
  const open = existing.positionHistory.find((e) => e.toAt === null);
  if (open) open.toAt = now;
  existing.currentRoleId = held?.roleId ?? null;
  if (held) {
    existing.positionHistory.push({ roleId: held.roleId, fromAt: now, toAt: null });
    if (existing.terminated) {
      existing.terminated = false;
      delete existing.terminatedAt;
    }
  }
  await queueWrite(data);
  return { created: false, changed: true, profile: existing };
}

export async function recordPromotion(guildId: string, userId: string, fromRoleId: string | null, toRoleId: string, byUserId: string, reason?: string): Promise<StaffProfile> {
  const data = await load();
  const g = ensureGuild(data, guildId);
  let profile = g.profiles[userId];
  const now = Date.now();
  if (!profile) {
    profile = newProfile(userId, now);
    g.profiles[userId] = profile;
  }
  profile.promotions.push({ fromRoleId, toRoleId, at: now, byUserId, reason });
  await queueWrite(data);
  return profile;
}

export async function recordDemotion(guildId: string, userId: string, fromRoleId: string, toRoleId: string | null, byUserId: string, reason?: string): Promise<StaffProfile> {
  const data = await load();
  const g = ensureGuild(data, guildId);
  let profile = g.profiles[userId];
  const now = Date.now();
  if (!profile) {
    profile = newProfile(userId, now);
    g.profiles[userId] = profile;
  }
  profile.demotions.push({ fromRoleId, toRoleId, at: now, byUserId, reason });
  if (toRoleId === null) {
    profile.terminated = true;
    profile.terminatedAt = now;
    profile.currentRoleId = null;
    delete g.profiles[userId];
  }
  await queueWrite(data);
  return profile;
}

export async function deleteProfile(guildId: string, userId: string): Promise<boolean> {
  const data = await load();
  const g = data[guildId];
  if (!g || !g.profiles[userId]) return false;
  delete g.profiles[userId];
  await queueWrite(data);
  return true;
}

export async function recordInfraction(guildId: string, userId: string, type: InfractionType, byUserId: string, reason: string): Promise<InfractionEntry> {
  const data = await load();
  const g = ensureGuild(data, guildId);
  let profile = g.profiles[userId];
  const now = Date.now();
  if (!profile) {
    profile = newProfile(userId, now);
    g.profiles[userId] = profile;
  }
  const entry: InfractionEntry = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, type, at: now, byUserId, reason };
  if (type === "strike") entry.expiresAt = now + 14 * 24 * 60 * 60 * 1000;
  profile.infractions.push(entry);
  if (type === "termination") {
    profile.terminated = true;
    profile.terminatedAt = now;
    profile.currentRoleId = null;
    delete g.profiles[userId];
  }
  await queueWrite(data);
  return entry;
}

export async function removeInfraction(guildId: string, userId: string, infractionId: string): Promise<InfractionEntry | null> {
  const data = await load();
  const profile = data[guildId]?.profiles[userId];
  if (!profile) return null;
  const idx = profile.infractions.findIndex((i) => i.id === infractionId);
  if (idx === -1) return null;
  const removed = profile.infractions.splice(idx, 1)[0]!;
  await queueWrite(data);
  return removed;
}

export async function removeInfractionsByType(
  guildId: string,
  userId: string,
  type: InfractionType,
): Promise<number> {
  const data = await load();
  const profile = data[guildId]?.profiles[userId];
  if (!profile) return 0;
  const before = profile.infractions.length;
  profile.infractions = profile.infractions.filter((i) => i.type !== type);
  const removed = before - profile.infractions.length;
  if (removed > 0) {
    await queueWrite(data);
  }
  return removed;
}

export function getActiveInfractions(profile: StaffProfile, type?: InfractionType, now: number = Date.now()): InfractionEntry[] {
  return profile.infractions.filter((i) => {
    if (type && i.type !== type) return false;
    if (i.expiresAt && i.expiresAt < now) return false;
    return true;
  });
}

export async function listAllProfiles(guildId: string): Promise<StaffProfile[]> {
  return listProfiles(guildId);
}

export async function getAllGuildIds(): Promise<string[]> {
  const data = await load();
  return Object.keys(data);
}

export async function markInfractionExpiryDmSent(guildId: string, userId: string, infractionId: string): Promise<void> {
  const data = await load();
  const profile = data[guildId]?.profiles[userId];
  if (!profile) return;
  const inf = profile.infractions.find((i) => i.id === infractionId);
  if (!inf) return;
  inf.expiryDmSent = true;
  await queueWrite(data);
}

export function activeStrikes(infractions: InfractionEntry[], now: number = Date.now(), expiryDays = 0): InfractionEntry[] {
  return infractions.filter((i) => {
    if (i.type !== "strike") return false;
    if (i.expiresAt && i.expiresAt < now) return false;
    if (expiryDays > 0 && i.at + expiryDays * 86_400_000 < now) return false;
    return true;
  });
}

export async function expireActiveStrikes(guildId: string, userId: string): Promise<number> {
  const data = await load();
  const profile = data[guildId]?.profiles[userId];
  if (!profile) return 0;
  const now = Date.now();
  let count = 0;
  for (const inf of profile.infractions) {
    if (inf.type !== "strike") continue;
    if (inf.expiresAt && inf.expiresAt <= now) continue;
    inf.expiresAt = now - 1;
    count += 1;
  }
  if (count > 0) await queueWrite(data);
  return count;
}

export async function incrementPartnershipScore(guildId: string, userId: string): Promise<StaffProfile | null> {
  const data = await load();
  const g = data[guildId];
  if (!g) return null;
  const profile = g.profiles[userId];
  if (!profile) return null;
  profile.partnershipScore += 1;
  await queueWrite(data);
  return profile;
}

export async function addStaffRating(guildId: string, userId: string, rating: number): Promise<StaffProfile | null> {
  const data = await load();
  const g = data[guildId];
  if (!g) return null;
  const profile = g.profiles[userId];
  if (!profile) return null;
  
  if (typeof profile.ratingSum !== "number") profile.ratingSum = 0;
  if (typeof profile.ratingCount !== "number") profile.ratingCount = 0;
  
  profile.ratingSum += rating;
  profile.ratingCount += 1;
  
  await queueWrite(data);
  return profile;
}

export async function setFeedbackCooldown(guildId: string, staffId: string, submitterId: string): Promise<void> {
  const data = await load();
  const g = data[guildId];
  if (!g) return;
  const profile = g.profiles[staffId];
  if (!profile) return;
  
  if (!profile.feedbackCooldowns) profile.feedbackCooldowns = {};
  profile.feedbackCooldowns[submitterId] = Date.now();
  
  await queueWrite(data);
}

export async function resetStaffData(guildId: string): Promise<void> {
  const data = await load();
  if (data[guildId]) {
    data[guildId] = { roles: [], profiles: {} };
    await queueWrite(data);
  }
}
