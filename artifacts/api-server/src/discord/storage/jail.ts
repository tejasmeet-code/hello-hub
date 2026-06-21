import {
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
} from "discord.js";
import { dataFile } from "../../lib/paths";
import { loadPersistentJson, persistPersistentJson } from "./persistentJson";

export interface StashedRoles {
  /** Role IDs that were removed from the user when they were jailed. */
  roleIds: string[];
  /** Unix ms when the jail was applied. */
  at: number;
  /** Moderator user id who issued the jail. */
  byUserId: string;
  /** Reason supplied to the jail command. */
  reason: string;
}

interface GuildJail {
  roleId: string;
  stashed?: Record<string, StashedRoles>;
}

const FILE_PATH = dataFile("jail.json");

let cache: Record<string, GuildJail> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, GuildJail>> {
  if (cache) return cache;
  cache = await loadPersistentJson("jail.json", FILE_PATH, {});
  return cache;
}

async function persist(data: Record<string, GuildJail>): Promise<void> {
  await persistPersistentJson("jail.json", FILE_PATH, data);
}

function queueWrite(data: Record<string, GuildJail>): Promise<void> {
  writeQueue = writeQueue.then(() => persist(data)).catch(() => {});
  return writeQueue;
}

export async function getJailRoleId(guildId: string): Promise<string | null> {
  const data = await load();
  return data[guildId]?.roleId ?? null;
}

export async function setJailRoleId(
  guildId: string,
  roleId: string,
): Promise<void> {
  const data = await load();
  data[guildId] = { roleId };
  await queueWrite(data);
}

const JAIL_ROLE_NAME = "Jailed";

/**
 * Ensure a "Jailed" role exists in the guild and that every channel denies
 * View Channel for it. Returns the role id, or null if we can't manage roles.
 *
 * Idempotent and best-effort: existing channel overwrites are not removed.
 */
export async function ensureJailRole(guild: Guild): Promise<string | null> {
  // Honour an existing stored mapping if the role still exists.
  const stored = await getJailRoleId(guild.id);
  if (stored) {
    const existing = guild.roles.cache.get(stored)
      ?? (await guild.roles.fetch(stored).catch(() => null));
    if (existing) {
      await applyChannelOverwrites(guild, existing.id).catch(() => {});
      return existing.id;
    }
  }

  // Look for an existing role by name.
  const byName = guild.roles.cache.find((r) => r.name === JAIL_ROLE_NAME);
  let roleId: string | null = null;
  if (byName) {
    roleId = byName.id;
  } else {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return null;
    try {
      const created = await guild.roles.create({
        name: JAIL_ROLE_NAME,
        color: 0x2c2f33,
        hoist: false,
        mentionable: false,
        reason: "Auto-created by bot for /jail command",
        permissions: [],
      });
      roleId = created.id;
      // Position the jail role just below the bot's highest role so the bot can assign it
      const botHighest = me?.roles.highest.position ?? 1;
      const targetPos = Math.max(1, botHighest - 1);
      await guild.roles.setPositions([{ role: created.id, position: targetPos }]).catch(() => {});
    } catch {
      return null;
    }
  }

  if (!roleId) return null;
  await setJailRoleId(guild.id, roleId);
  await applyChannelOverwrites(guild, roleId).catch(() => {});
  return roleId;
}

// ---------------- Stashed-roles persistence ----------------

export async function getStashedRoles(
  guildId: string,
  userId: string,
): Promise<StashedRoles | null> {
  const data = await load();
  return data[guildId]?.stashed?.[userId] ?? null;
}

export async function setStashedRoles(
  guildId: string,
  userId: string,
  stash: StashedRoles,
): Promise<void> {
  const data = await load();
  const g = data[guildId];
  if (!g) return; // jail role hasn't been initialised yet — defensive
  g.stashed = g.stashed ?? {};
  g.stashed[userId] = stash;
  await queueWrite(data);
}

export async function clearStashedRoles(
  guildId: string,
  userId: string,
): Promise<void> {
  const data = await load();
  const g = data[guildId];
  if (!g?.stashed) return;
  delete g.stashed[userId];
  await queueWrite(data);
}

// ---------------- Jail / unjail role manipulation ----------------

/**
 * Strip every "access-granting" role from `member` and apply the Jailed role
 * in a single PATCH (atomic from Discord's perspective). Returns the list of
 * role IDs that were removed so the caller can stash them.
 *
 * Roles that are kept in place:
 *  - the @everyone role,
 *  - any managed role (Booster, integration roles, bot roles),
 *  - roles above or equal to the bot's highest role (we can't remove those).
 *
 * The user's existing roles are stashed via `setStashedRoles` so /unjail can
 * put them back exactly as they were.
 */
export async function applyJailToMember(
  member: GuildMember,
  jailRoleId: string,
  by: GuildMember,
  reason: string,
): Promise<{ removed: string[]; couldNotRemove: string[] }> {
  const guild = member.guild;
  const me = guild.members.me;
  const myTopPos = me?.roles.highest.position ?? 0;

  const removable: string[] = [];
  const kept: string[] = [];
  const couldNotRemove: string[] = [];

  for (const [id, role] of member.roles.cache) {
    if (id === guild.id) continue; // @everyone is implicit
    if (id === jailRoleId) continue;
    if (role.managed) {
      kept.push(id);
      continue;
    }
    if (role.position >= myTopPos) {
      // Can't remove — bot is at or below this role.
      couldNotRemove.push(id);
      kept.push(id);
      continue;
    }
    removable.push(id);
  }

  // New role set = kept (managed + above-bot) + jail role.
  const finalRoles = new Set<string>([...kept, jailRoleId]);

  await member.roles.set(
    [...finalRoles],
    `Jailed by ${by.user.tag}: ${reason}`.slice(0, 512),
  );

  await setStashedRoles(guild.id, member.id, {
    roleIds: removable,
    at: Date.now(),
    byUserId: by.id,
    reason,
  });

  return { removed: removable, couldNotRemove };
}

/**
 * Reverse `applyJailToMember`: remove the Jailed role and add back every
 * stashed role that still exists in the guild and that the bot can manage.
 * Returns counts so the caller can report the result.
 */
export async function releaseJailFromMember(
  member: GuildMember,
  jailRoleId: string,
  by: GuildMember,
  reason: string,
): Promise<{ restored: number; missing: number; aboveBot: number }> {
  const guild = member.guild;
  const me = guild.members.me;
  const myTopPos = me?.roles.highest.position ?? 0;

  const stash = await getStashedRoles(guild.id, member.id);
  let restored = 0;
  let missing = 0;
  let aboveBot = 0;

  const finalRoles = new Set<string>(member.roles.cache.keys());
  finalRoles.delete(jailRoleId);

  if (stash) {
    for (const roleId of stash.roleIds) {
      const role =
        guild.roles.cache.get(roleId) ??
        (await guild.roles.fetch(roleId).catch(() => null));
      if (!role) {
        missing += 1;
        continue;
      }
      if (role.position >= myTopPos) {
        aboveBot += 1;
        continue;
      }
      finalRoles.add(roleId);
      restored += 1;
    }
  }

  await member.roles.set(
    [...finalRoles],
    `Unjailed by ${by.user.tag}: ${reason}`.slice(0, 512),
  );

  await clearStashedRoles(guild.id, member.id);
  return { restored, missing, aboveBot };
}

async function applyChannelOverwrites(
  guild: Guild,
  roleId: string,
): Promise<void> {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return;
  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) return;
  for (const channel of channels.values()) {
    if (!channel) continue;
    // Skip thread / categories that don't have permissionOverwrites
    const overwrites = (channel as unknown as {
      permissionOverwrites?: { edit: (id: string, deny: object, opts?: object) => Promise<unknown> };
    }).permissionOverwrites;
    if (!overwrites) continue;
    try {
      await overwrites.edit(
        roleId,
        {
          ViewChannel: false,
          SendMessages: false,
          AddReactions: false,
          Connect: false,
          Speak: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
        },
        { reason: "Bot: jail role denial" },
      );
    } catch {
      // Skip channels we can't edit.
    }
  }
}