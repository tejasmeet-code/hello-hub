import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export interface PartnershipSubmission {
  id: string;
  staffUserId: string;
  serverUrl?: string;
  message: string;
  proof?: string;
  submittedAt: number;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: number;
  reviewReason?: string;
}

export interface GuildPartnerships {
  submissions: PartnershipSubmission[];
}

const FILE_PATH = dataFile("partnerships.json");
let cache: Record<string, GuildPartnerships> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, GuildPartnerships>> {
  if (cache) return cache;
  cache = await loadPersistentJson("partnerships.json", FILE_PATH, {});
  return cache;
}

async function persist(data: Record<string, GuildPartnerships>): Promise<void> {
  await persistPersistentJson("partnerships.json", FILE_PATH, data);
}

function ensureGuild(data: Record<string, GuildPartnerships>, guildId: string): GuildPartnerships {
  if (!data[guildId]) data[guildId] = { submissions: [] };
  return data[guildId];
}

function queueWrite(data: Record<string, GuildPartnerships>): Promise<void> {
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  return writeQueue;
}

export async function getPartnerships(guildId: string): Promise<PartnershipSubmission[]> {
  const data = await load();
  const g = data[guildId];
  return g ? g.submissions : [];
}

export async function addPartnershipSubmission(
  guildId: string,
  submission: Omit<PartnershipSubmission, "id" | "submittedAt" | "status">
): Promise<PartnershipSubmission> {
  const data = await load();
  const g = ensureGuild(data, guildId);
  const newSubmission: PartnershipSubmission = {
    ...submission,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    submittedAt: Date.now(),
    status: "pending",
  };
  g.submissions.push(newSubmission);
  await queueWrite(data);
  return newSubmission;
}

export async function updatePartnershipStatus(
  guildId: string,
  submissionId: string,
  status: PartnershipSubmission["status"],
  reviewedBy: string,
  reviewReason?: string
): Promise<boolean> {
  const data = await load();
  const g = data[guildId];
  if (!g) return false;
  const submission = g.submissions.find(s => s.id === submissionId);
  if (!submission) return false;
  submission.status = status;
  submission.reviewedBy = reviewedBy;
  submission.reviewedAt = Date.now();
  if (reviewReason) submission.reviewReason = reviewReason;
  await queueWrite(data);
  return true;
}