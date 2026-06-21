import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export type CaseAction = "ban" | "unban" | "mute" | "unmute" | "warn" | "jail" | "unjail" | "kick" | "untimeout" | "ban-request";

export interface Case {
  id: number;
  guild_id: string;
  case_number: number;
  action: CaseAction;
  moderator_id: string;
  target_id: string;
  reason: string;
  proof: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface GuildCases {
  nextNumber: number;
  cases: Case[];
}

const FILE_PATH = dataFile("cases.json");

let cache: Record<string, GuildCases> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, GuildCases>> {
  if (cache) return cache;
  cache = await loadPersistentJson("cases.json", FILE_PATH, {});
  return cache;
}

async function persist(data: Record<string, GuildCases>): Promise<void> {
  await persistPersistentJson("cases.json", FILE_PATH, data);
}

function queueWrite(data: Record<string, GuildCases>): Promise<void> {
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  return writeQueue;
}

function ensureGuild(data: Record<string, GuildCases>, guildId: string): GuildCases {
  if (!data[guildId]) data[guildId] = { nextNumber: 1, cases: [] };
  return data[guildId];
}

export async function getNextCaseNumber(guildId: string): Promise<number> {
  const data = await load();
  return ensureGuild(data, guildId).nextNumber;
}

export async function createCase(input: {
  guildId: string;
  action: CaseAction;
  moderatorId: string;
  targetId: string;
  reason: string;
  proof?: string | null;
}): Promise<Case> {
  const data = await load();
  const g = ensureGuild(data, input.guildId);
  const now = new Date().toISOString();
  const c: Case = {
    id: g.nextNumber,
    guild_id: input.guildId,
    case_number: g.nextNumber,
    action: input.action,
    moderator_id: input.moderatorId,
    target_id: input.targetId,
    reason: input.reason,
    proof: input.proof ?? null,
    active: true,
    created_at: now,
    updated_at: now,
  };
  g.nextNumber++;
  g.cases.push(c);
  await queueWrite(data);
  return c;
}

export async function getCase(guildId: string, caseNumber: number): Promise<Case | null> {
  const data = await load();
  return data[guildId]?.cases.find(c => c.case_number === caseNumber) ?? null;
}

export async function editCase(
  guildId: string,
  caseNumber: number,
  updates: { reason?: string; active?: boolean },
): Promise<Case | null> {
  const data = await load();
  const g = data[guildId];
  if (!g) return null;
  const c = g.cases.find(c => c.case_number === caseNumber);
  if (!c) return null;
  if (updates.reason !== undefined) c.reason = updates.reason;
  if (updates.active !== undefined) c.active = updates.active;
  c.updated_at = new Date().toISOString();
  await queueWrite(data);
  return c;
}

export async function listCases(guildId: string, targetId?: string): Promise<Case[]> {
  const data = await load();
  const cases = data[guildId]?.cases ?? [];
  const filtered = targetId ? cases.filter(c => c.target_id === targetId) : cases;
  return [...filtered].sort((a, b) => b.case_number - a.case_number).slice(0, 50);
}

export async function deactivateCase(guildId: string, caseNumber: number): Promise<void> {
  await editCase(guildId, caseNumber, { active: false });
}