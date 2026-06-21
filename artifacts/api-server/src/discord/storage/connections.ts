import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export type ServerRole = "staff" | "main" | "appeals" | "secondary";

export interface PendingConnection {
  id: string;
  fromGuildId: string;
  toGuildId: string;
  declaredFromRole: ServerRole;
  requestedBy: string;
  requestedAt: number;
}

export interface ActiveConnection {
  id: string;
  guildAId: string;
  guildARole: ServerRole;
  guildBId: string;
  guildBRole: ServerRole;
  establishedAt: number;
  approvedBy: string;
}

interface ConnectionsStore {
  pending: PendingConnection[];
  active: ActiveConnection[];
}

const FILE_PATH = dataFile("connections.json");

let cache: ConnectionsStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

/** Migrate legacy { staffGuildId, mainGuildId } entries to the new model. */
function migrate(raw: any): ConnectionsStore {
  const pending: PendingConnection[] = Array.isArray(raw.pending) ? raw.pending : [];
  const active: ActiveConnection[] = [];

  for (const entry of (Array.isArray(raw.active) ? raw.active : [])) {
    if (entry.id && entry.guildAId) {
      // Already new format
      active.push(entry as ActiveConnection);
    } else if (entry.staffGuildId && entry.mainGuildId) {
      // Legacy format — convert
      active.push({
        id: `legacy-${entry.staffGuildId}-${entry.mainGuildId}`,
        guildAId: entry.staffGuildId,
        guildARole: "staff",
        guildBId: entry.mainGuildId,
        guildBRole: "main",
        establishedAt: entry.establishedAt ?? Date.now(),
        approvedBy: entry.approvedBy ?? "unknown",
      });
    }
  }

  return { pending, active };
}

async function load(): Promise<ConnectionsStore> {
  if (cache) return cache;
  const raw = await loadPersistentJson<unknown>("connections.json", FILE_PATH, {
    pending: [],
    active: [],
  });
  cache = migrate(raw);
  return cache;
}

async function persist(data: ConnectionsStore): Promise<void> {
  await persistPersistentJson("connections.json", FILE_PATH, data);
}

function queueWrite(data: ConnectionsStore): Promise<void> {
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  return writeQueue;
}

/** Opposite role for a two-server pair. */
function oppositeRole(role: ServerRole): ServerRole {
  if (role === "staff") return "main";
  if (role === "main") return "staff";
  if (role === "secondary") return "secondary";
  return "main"; // when an appeals server initiates, the other side is "main"
}

export async function listPending(): Promise<PendingConnection[]> {
  const d = await load();
  return [...d.pending];
}

export async function listActive(): Promise<ActiveConnection[]> {
  const d = await load();
  return [...d.active];
}

export async function createPending(
  fromGuildId: string,
  toGuildId: string,
  declaredFromRole: ServerRole,
  requestedBy: string,
): Promise<PendingConnection> {
  const d = await load();
  // Cancel any existing pending in either direction between these two guilds.
  d.pending = d.pending.filter(
    (p) =>
      !(
        (p.fromGuildId === fromGuildId && p.toGuildId === toGuildId) ||
        (p.fromGuildId === toGuildId && p.toGuildId === fromGuildId)
      ),
  );
  const entry: PendingConnection = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    fromGuildId,
    toGuildId,
    declaredFromRole,
    requestedBy,
    requestedAt: Date.now(),
  };
  d.pending.push(entry);
  await queueWrite(d);
  return entry;
}

export async function findPendingByGuilds(
  guildAId: string,
  guildBId: string,
): Promise<PendingConnection | null> {
  const d = await load();
  return (
    d.pending.find(
      (p) =>
        (p.fromGuildId === guildAId && p.toGuildId === guildBId) ||
        (p.fromGuildId === guildBId && p.toGuildId === guildAId),
    ) ?? null
  );
}

export async function approvePending(
  pendingId: string,
  approvedByUserId: string,
): Promise<ActiveConnection | null> {
  const d = await load();
  const idx = d.pending.findIndex((p) => p.id === pendingId);
  if (idx === -1) return null;
  const p = d.pending.splice(idx, 1)[0]!;

  // Remove only existing connections between THIS specific pair of guilds.
  d.active = d.active.filter(
    (a) =>
      !(
        (a.guildAId === p.fromGuildId && a.guildBId === p.toGuildId) ||
        (a.guildAId === p.toGuildId && a.guildBId === p.fromGuildId)
      ),
  );

  const active: ActiveConnection = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    guildAId: p.fromGuildId,
    guildARole: p.declaredFromRole,
    guildBId: p.toGuildId,
    guildBRole: oppositeRole(p.declaredFromRole),
    establishedAt: Date.now(),
    approvedBy: approvedByUserId,
  };
  d.active.push(active);
  await queueWrite(d);
  return active;
}

export async function rejectPending(pendingId: string): Promise<boolean> {
  const d = await load();
  const idx = d.pending.findIndex((p) => p.id === pendingId);
  if (idx === -1) return false;
  d.pending.splice(idx, 1);
  await queueWrite(d);
  return true;
}

/** Disconnect a specific pair of guilds. Returns false if no match found. */
export async function disconnectGuild(
  guildId: string,
  otherGuildId: string,
): Promise<boolean> {
  const d = await load();
  const before = d.active.length;
  d.active = d.active.filter(
    (a) =>
      !(
        (a.guildAId === guildId && a.guildBId === otherGuildId) ||
        (a.guildAId === otherGuildId && a.guildBId === guildId)
      ),
  );
  if (d.active.length === before) return false;
  await queueWrite(d);
  return true;
}

/** All active connections this guild is part of. */
export async function getConnectionsByGuild(
  guildId: string,
): Promise<Array<{ conn: ActiveConnection; role: ServerRole; otherGuildId: string }>> {
  const d = await load();
  const results: Array<{ conn: ActiveConnection; role: ServerRole; otherGuildId: string }> = [];
  for (const a of d.active) {
    if (a.guildAId === guildId) {
      results.push({ conn: a, role: a.guildARole, otherGuildId: a.guildBId });
    } else if (a.guildBId === guildId) {
      results.push({ conn: a, role: a.guildBRole, otherGuildId: a.guildAId });
    }
  }
  return results;
}

/**
 * Backward-compatible helper used by crossServer / staffActions.
 * Returns the first staff↔main connection for this guild.
 */
export async function getConnectedGuildId(
  guildId: string,
): Promise<{ otherGuildId: string; role: ServerRole; mainGuildId: string } | null> {
  const all = await getConnectionsByGuild(guildId);
  // Prefer staff/main connections (not appeals)
  const link = all.find((c) => c.role === "staff" || c.role === "main");
  if (!link) return null;
  const mainGuildId =
    link.conn.guildARole === "main" ? link.conn.guildAId : link.conn.guildBId;
  return {
    otherGuildId: link.otherGuildId,
    role: link.role,
    mainGuildId,
  };
}
