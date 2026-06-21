import { randomUUID } from "node:crypto";
import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export type ModActionKind = "ban" | "kick" | "mute" | "jail" | "warn" | "any";

export type AutomationTrigger =
  | { type: "role_added"; roleId: string }
  | { type: "role_removed"; roleId: string }
  | { type: "member_joined" }
  | { type: "member_left" }
  | { type: "mod_action"; action: ModActionKind };

export type AutomationAction =
  | { type: "dm_user"; message: string }
  | { type: "dm_moderator"; message: string }
  | { type: "channel_message"; channelId: string; message: string };

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  createdAt: number;
}

const FILE_PATH = dataFile("automations.json");

type Store = Record<string, Automation[]>;

let cache: Store | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Store> {
  if (cache) return cache;
  cache = await loadPersistentJson<Store>("automations.json", FILE_PATH, {});
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  const data = cache;
  writeQueue = writeQueue
    .then(() => persistPersistentJson("automations.json", FILE_PATH, data))
    .catch(() => {});
  await writeQueue;
}

export async function listAutomations(guildId: string): Promise<Automation[]> {
  const data = await load();
  return [...(data[guildId] ?? [])];
}

export async function getAutomation(
  guildId: string,
  id: string,
): Promise<Automation | null> {
  const list = await listAutomations(guildId);
  return list.find((a) => a.id === id) ?? null;
}

export async function addAutomation(
  guildId: string,
  input: Omit<Automation, "id" | "createdAt" | "enabled"> & { enabled?: boolean },
): Promise<Automation> {
  const data = await load();
  const automation: Automation = {
    id: randomUUID().slice(0, 8),
    name: input.name,
    enabled: input.enabled ?? true,
    trigger: input.trigger,
    action: input.action,
    createdAt: Date.now(),
  };
  data[guildId] = [...(data[guildId] ?? []), automation];
  await persist();
  return automation;
}

export async function removeAutomation(
  guildId: string,
  id: string,
): Promise<boolean> {
  const data = await load();
  const list = data[guildId] ?? [];
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  data[guildId] = next;
  await persist();
  return true;
}

export async function setAutomationEnabled(
  guildId: string,
  id: string,
  enabled: boolean,
): Promise<boolean> {
  const data = await load();
  const list = data[guildId] ?? [];
  const target = list.find((a) => a.id === id);
  if (!target) return false;
  target.enabled = enabled;
  await persist();
  return true;
}

export async function findMatchingAutomations(
  guildId: string,
  predicate: (trigger: AutomationTrigger) => boolean,
): Promise<Automation[]> {
  const list = await listAutomations(guildId);
  return list.filter((a) => a.enabled && predicate(a.trigger));
}
