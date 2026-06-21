import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

interface PullableMember {
  userId: string;
  username: string;
  email?: string;
  discriminator?: string;
  avatar?: string;
  verifiedAt: string;
  serverId: string;
}

interface PullableMembersShape {
  members: PullableMember[];
}

const FILE_PATH = dataFile("pullable-members.json");

let cache: PullableMembersShape | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<PullableMembersShape> {
  if (cache) return cache;
  const parsed = await loadPersistentJson<Partial<PullableMembersShape>>(
    "pullable-members.json",
    FILE_PATH,
    { members: [] },
  );
  cache = {
    members: Array.isArray(parsed.members) ? parsed.members : [],
  };
  return cache;
}

async function persist(data: PullableMembersShape): Promise<void> {
  await persistPersistentJson("pullable-members.json", FILE_PATH, data);
}

export async function addPullableMember(member: PullableMember): Promise<boolean> {
  const data = await load();
  // Check if already exists
  const exists = data.members.some(m => m.userId === member.userId);
  if (exists) return false;

  data.members.push(member);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function getPullableMembers(): Promise<PullableMember[]> {
  const data = await load();
  return [...data.members];
}

export async function getPullableMemberCount(): Promise<number> {
  const data = await load();
  return data.members.length;
}

export async function removePullableMember(userId: string): Promise<boolean> {
  const data = await load();
  const index = data.members.findIndex(m => m.userId === userId);
  if (index === -1) return false;

  data.members.splice(index, 1);
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  await writeQueue;
  return true;
}

export async function isPullableMember(userId: string): Promise<boolean> {
  const data = await load();
  return data.members.some(m => m.userId === userId);
}