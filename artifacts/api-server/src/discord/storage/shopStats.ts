import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

const STORE = "shopStats";
const FILE = () => dataFile("shopStats.json");

// ── Types ────────────────────────────────────────────────────────────────────

export interface SaleRecord {
  ticketId: string;
  item: string;
  price: string;
  date: number;
  customerId: string;
  rating?: number;
}

export interface StaffShopStats {
  guildId: string;
  staffId: string;
  sales: SaleRecord[];
}

export interface PurchaseRecord {
  ticketId: string;
  item: string;
  price: string;
  date: number;
  staffId: string;
}

export interface CustomerRecord {
  guildId: string;
  userId: string;
  points: number;
  purchases: PurchaseRecord[];
}

interface StatsStore {
  staff: Record<string, StaffShopStats>;
  customers: Record<string, CustomerRecord>;
}

function staffKey(guildId: string, staffId: string) { return `${guildId}:${staffId}`; }
function customerKey(guildId: string, userId: string) { return `${guildId}:${userId}`; }

// ── Internal ─────────────────────────────────────────────────────────────────

let cache: StatsStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<StatsStore> {
  if (cache) return cache;
  cache = await loadPersistentJson<StatsStore>(STORE, FILE(), { staff: {}, customers: {} });
  return cache;
}

async function save(data: StatsStore): Promise<void> {
  cache = data;
  writeQueue = writeQueue.then(() => persistPersistentJson(STORE, FILE(), data));
  return writeQueue;
}

// ── Staff API ─────────────────────────────────────────────────────────────────

export async function getStaffShopStats(guildId: string, staffId: string): Promise<StaffShopStats> {
  const store = await load();
  return store.staff[staffKey(guildId, staffId)] ?? { guildId, staffId, sales: [] };
}

export async function addSale(
  guildId: string,
  staffId: string,
  sale: SaleRecord,
): Promise<StaffShopStats> {
  const store = await load();
  const key = staffKey(guildId, staffId);
  if (!store.staff[key]) store.staff[key] = { guildId, staffId, sales: [] };
  store.staff[key].sales.push(sale);
  await save(store);
  return store.staff[key];
}

export async function updateStaffSale(
  guildId: string,
  staffId: string,
  ticketId: string,
  patch: Partial<SaleRecord>,
): Promise<StaffShopStats | null> {
  const store = await load();
  const key = staffKey(guildId, staffId);
  const stats = store.staff[key];
  if (!stats) return null;
  const idx = stats.sales.findIndex((s) => s.ticketId === ticketId);
  if (idx === -1) return null;
  stats.sales[idx] = { ...stats.sales[idx], ...patch };
  await save(store);
  return stats;
}

export async function removeStaffSale(
  guildId: string,
  staffId: string,
  ticketId: string,
): Promise<StaffShopStats | null> {
  const store = await load();
  const key = staffKey(guildId, staffId);
  const stats = store.staff[key];
  if (!stats) return null;
  stats.sales = stats.sales.filter((s) => s.ticketId !== ticketId);
  await save(store);
  return stats;
}

export function avgRating(stats: StaffShopStats): number | null {
  const rated = stats.sales.filter((s) => s.rating != null);
  if (rated.length === 0) return null;
  return rated.reduce((sum, s) => sum + (s.rating ?? 0), 0) / rated.length;
}

export async function getAllStaffStats(guildId: string): Promise<StaffShopStats[]> {
  const store = await load();
  return Object.values(store.staff).filter((s) => s.guildId === guildId);
}

// ── Customer API ──────────────────────────────────────────────────────────────

export async function getCustomerRecord(guildId: string, userId: string): Promise<CustomerRecord> {
  const store = await load();
  return store.customers[customerKey(guildId, userId)] ?? { guildId, userId, points: 0, purchases: [] };
}

export async function addPurchase(
  guildId: string,
  userId: string,
  purchase: PurchaseRecord,
): Promise<CustomerRecord> {
  const store = await load();
  const key = customerKey(guildId, userId);
  if (!store.customers[key]) store.customers[key] = { guildId, userId, points: 0, purchases: [] };
  store.customers[key].points += 1;
  store.customers[key].purchases.push(purchase);
  await save(store);
  return store.customers[key];
}

export async function updateCustomerPurchase(
  guildId: string,
  userId: string,
  ticketId: string,
  patch: Partial<PurchaseRecord>,
): Promise<CustomerRecord | null> {
  const store = await load();
  const key = customerKey(guildId, userId);
  const rec = store.customers[key];
  if (!rec) return null;
  const idx = rec.purchases.findIndex((p) => p.ticketId === ticketId);
  if (idx === -1) return null;
  rec.purchases[idx] = { ...rec.purchases[idx], ...patch };
  await save(store);
  return rec;
}

export async function removeCustomerPurchase(
  guildId: string,
  userId: string,
  ticketId: string,
): Promise<CustomerRecord | null> {
  const store = await load();
  const key = customerKey(guildId, userId);
  const rec = store.customers[key];
  if (!rec) return null;
  const before = rec.purchases.length;
  rec.purchases = rec.purchases.filter((p) => p.ticketId !== ticketId);
  if (rec.purchases.length < before) rec.points = Math.max(0, rec.points - 1);
  await save(store);
  return rec;
}

export async function setCustomerPoints(
  guildId: string,
  userId: string,
  points: number,
): Promise<CustomerRecord> {
  const store = await load();
  const key = customerKey(guildId, userId);
  if (!store.customers[key]) store.customers[key] = { guildId, userId, points: 0, purchases: [] };
  store.customers[key].points = Math.max(0, points);
  await save(store);
  return store.customers[key];
}