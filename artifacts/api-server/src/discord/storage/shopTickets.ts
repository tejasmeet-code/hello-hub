import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "shopTickets";
const FILE = () => dataFile("shopTickets.json");

// ── Types ────────────────────────────────────────────────────────────────────

export type TicketStatus = "open" | "claimed" | "closed";

export interface ShopTicket {
  ticketId: string;
  shopId: string;
  shopName: string;
  guildId: string;
  userId: string;
  channelId: string;
  claimedBy?: string;
  allowedViewers: string[];
  answers: string[];
  status: TicketStatus;
  outcome?: "success" | "failure";
  item?: string;
  price?: string;
  rating?: number;
  ratingMessageId?: string;
  createdAt: number;
  closedAt?: number;
}

interface TicketStore {
  byChannel: Record<string, ShopTicket>;
  byId: Record<string, string>;
}

// ── Internal ─────────────────────────────────────────────────────────────────

let cache: TicketStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<TicketStore> {
  if (cache) return cache;
  cache = await loadPersistentJson<TicketStore>(STORE, FILE(), { byChannel: {}, byId: {} });
  return cache;
}

async function save(data: TicketStore): Promise<void> {
  cache = data;
  writeQueue = writeQueue.then(() => persistPersistentJson(STORE, FILE(), data));
  return writeQueue;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function saveTicket(ticket: ShopTicket): Promise<void> {
  const store = await load();
  store.byChannel[ticket.channelId] = ticket;
  store.byId[ticket.ticketId] = ticket.channelId;
  await save(store);
}

export async function getTicketByChannel(channelId: string): Promise<ShopTicket | null> {
  const store = await load();
  return store.byChannel[channelId] ?? null;
}

export async function getTicketById(ticketId: string): Promise<ShopTicket | null> {
  const store = await load();
  const channelId = store.byId[ticketId];
  if (!channelId) return null;
  return store.byChannel[channelId] ?? null;
}

export async function updateTicket(
  channelId: string,
  mutator: (t: ShopTicket) => ShopTicket,
): Promise<ShopTicket | null> {
  const store = await load();
  const ticket = store.byChannel[channelId];
  if (!ticket) return null;
  const updated = mutator(ticket);
  store.byChannel[channelId] = updated;
  store.byId[updated.ticketId] = channelId;
  await save(store);
  return updated;
}

export async function deleteTicket(channelId: string): Promise<void> {
  const store = await load();
  const ticket = store.byChannel[channelId];
  if (!ticket) return;
  delete store.byChannel[channelId];
  delete store.byId[ticket.ticketId];
  await save(store);
}