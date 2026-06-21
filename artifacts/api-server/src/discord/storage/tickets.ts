import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export interface TicketPanel {
  id: string;
  name: string;
  embedTitle: string;
  embedDescription: string;
  embedColor: number;
  buttonLabel: string;
  buttonEmoji?: string;
  supportRoleId?: string;
  categoryId?: string;
  panelChannelId?: string;
  panelMessageId?: string;
  questions?: TicketQuestion[];
}

export interface MultiPanelConfig {
  channelId?: string;
  messageId?: string;
  panelIds: string[];
  embedTitle: string;
  embedDescription: string;
  useButtons: boolean;
}

export interface TicketsModuleConfig {
  enabled: boolean;
  supportRoleId?: string;
  adminRoleId?: string;
  logChannelId?: string;
  transcriptChannelId?: string;
  panels: Record<string, TicketPanel>;
  multiPanel?: MultiPanelConfig;
}

export interface TicketQuestion {
  label: string;
  style: "short" | "paragraph";
  required: boolean;
}

export interface OpenTicket {
  ticketId: string;
  panelId: string;
  channelId: string;
  guildId: string;
  userId: string;
  createdAt: number;
  status: "open" | "closed";
  claimedBy?: string;
}

interface GuildTickets {
  config: TicketsModuleConfig;
  counters: Record<string, number>;
  openTickets: Record<string, OpenTicket>;
}

const FILE_PATH = dataFile("tickets.json");
let cache: Record<string, GuildTickets> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, GuildTickets>> {
  if (cache) return cache;
  cache = await loadPersistentJson("tickets.json", FILE_PATH, {});
  return cache;
}

async function persist(data: Record<string, GuildTickets>): Promise<void> {
  await persistPersistentJson("tickets.json", FILE_PATH, data);
}

function queueWrite(data: Record<string, GuildTickets>): void {
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
}

function emptyGuild(): GuildTickets {
  return {
    config: {
      enabled: false,
      panels: {},
    },
    counters: {},
    openTickets: {},
  };
}

export async function getTicketsConfig(guildId: string): Promise<TicketsModuleConfig> {
  const data = await load();
  return data[guildId]?.config ?? emptyGuild().config;
}

export async function updateTicketsConfig(
  guildId: string,
  fn: (c: TicketsModuleConfig) => TicketsModuleConfig,
): Promise<TicketsModuleConfig> {
  const data = await load();
  if (!data[guildId]) data[guildId] = emptyGuild();
  data[guildId]!.config = fn(data[guildId]!.config);
  queueWrite(data);
  return data[guildId]!.config;
}

export async function getNextTicketNumber(guildId: string, panelId: string): Promise<number> {
  const data = await load();
  if (!data[guildId]) data[guildId] = emptyGuild();
  const g = data[guildId]!;
  g.counters[panelId] = (g.counters[panelId] ?? 0) + 1;
  queueWrite(data);
  return g.counters[panelId]!;
}

export async function createOpenTicket(ticket: OpenTicket): Promise<void> {
  const data = await load();
  if (!data[ticket.guildId]) data[ticket.guildId] = emptyGuild();
  data[ticket.guildId]!.openTickets[ticket.channelId] = ticket;
  queueWrite(data);
}

export async function getOpenTicketByChannel(
  guildId: string,
  channelId: string,
): Promise<OpenTicket | null> {
  const data = await load();
  return data[guildId]?.openTickets[channelId] ?? null;
}

export async function getOpenTicketsByUser(
  guildId: string,
  userId: string,
  panelId: string,
): Promise<OpenTicket[]> {
  const data = await load();
  return Object.values(data[guildId]?.openTickets ?? {}).filter(
    (t) => t.userId === userId && t.panelId === panelId && t.status === "open",
  );
}

export async function closeOpenTicket(guildId: string, channelId: string): Promise<void> {
  const data = await load();
  const t = data[guildId]?.openTickets[channelId];
  if (t) {
    t.status = "closed";
    delete data[guildId]!.openTickets[channelId];
    queueWrite(data);
  }
}

export async function claimTicket(
  guildId: string,
  channelId: string,
  claimedBy: string,
): Promise<OpenTicket | null> {
  const data = await load();
  const t = data[guildId]?.openTickets[channelId];
  if (!t) return null;
  t.claimedBy = claimedBy;
  queueWrite(data);
  return t;
}
