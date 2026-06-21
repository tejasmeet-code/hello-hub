import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { ChannelType, type Guild, OverwriteType } from "discord.js";
import { DATA_DIR, dataFile } from "../../lib/paths";
import { logger } from "../../lib/logger";
import { supabase } from "./supabase";

const FILE_PATH = dataFile("server-backups.json");
const MAX_BACKUPS_PER_GUILD = 10;

export interface BackupPermOverwrite {
  id: string;
  type: OverwriteType;
  allow: string;
  deny: string;
}

export interface BackupRole {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
  position: number;
}

export interface BackupMemberRole {
  userId: string;
  roleIds: string[];
}

export interface BackupMessage {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  timestamp: number;
  attachments: { name: string; url: string }[];
  embeds: any[];
}

export interface BackupChannel {
  id: string;
  name: string;
  type: ChannelType;
  position: number;
  topic?: string;
  nsfw?: boolean;
  rateLimitPerUser?: number;
  parentId?: string;
  permissionOverwrites: BackupPermOverwrite[];
  messages?: BackupMessage[];
}

export interface BackupBotPresence {
  userId: string;
  botTag: string;
}

export interface BackupSettings {
  verificationLevel: number;
  explicitContentFilter: number;
  defaultMessageNotifications: number;
  systemChannelId?: string;
}

export interface ServerBackup {
  id: string; // Unique 8-char alphanumeric ID
  takenAt: number;
  trigger: "join" | "periodic" | "manual";
  guildId: string;
  guildName: string;
  guildIcon: string | null;
  roles: BackupRole[];
  memberRoles: BackupMemberRole[];
  channels: BackupChannel[];
  bots: BackupBotPresence[];
  settings: BackupSettings;
}

interface BackupStore {
  guilds: Record<string, ServerBackup[]>;
}

let cache: BackupStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let autoBackupStarted = false;

function generateUniqueBackupId(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

async function load(): Promise<BackupStore> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    cache = JSON.parse(raw) as BackupStore;
    if (!cache.guilds) cache.guilds = {};
  } catch {
    cache = { guilds: {} };
  }
  return cache;
}

async function persist(store: BackupStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function queueWrite(store: BackupStore): void {
  writeQueue = writeQueue.then(() => persist(store)).catch(() => {});
}

async function saveBackupToSupabase(backup: ServerBackup): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from("server_backups")
      .upsert({
        id: backup.id,
        guild_id: backup.guildId,
        trigger: backup.trigger,
        taken_at: new Date(backup.takenAt).toISOString(),
        data: backup,
      }, { onConflict: "id" });
    if (error) throw error;
  } catch (err) {
    logger.warn({ err, guildId: backup.guildId, backupId: backup.id }, "serverBackup: could not save to Supabase");
  }
}

async function fetchBackupsFromSupabase(guildId: string): Promise<ServerBackup[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("server_backups")
      .select("data")
      .eq("guild_id", guildId)
      .order("taken_at", { ascending: false });
    if (error) throw error;
    if (!data) return [];
    return (data as Array<{ data: ServerBackup }>).map((row) => row.data);
  } catch (err) {
    logger.warn({ err, guildId }, "serverBackup: Supabase list query failed");
    return null;
  }
}

async function fetchBackupFromSupabaseById(id: string): Promise<ServerBackup | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("server_backups")
      .select("data")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return (data as { data: ServerBackup }).data;
  } catch (err) {
    logger.warn({ err, backupId: id }, "serverBackup: Supabase get-by-id query failed");
    return null;
  }
}

async function deleteBackupsForGuildSupabase(guildId: string): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("server_backups").delete().eq("guild_id", guildId);
    if (error) throw error;
  } catch (err) {
    logger.warn({ err, guildId }, "serverBackup: Supabase delete query failed");
  }
}

export async function listBackups(guildId: string): Promise<ServerBackup[]> {
  const supabaseBackups = await fetchBackupsFromSupabase(guildId);
  const store = await load();
  const localBackups = [...(store.guilds[guildId] ?? [])].sort((a, b) => b.takenAt - a.takenAt);
  if (supabaseBackups === null) return localBackups;
  if (supabaseBackups.length === 0 && localBackups.length > 0) return localBackups;
  return supabaseBackups;
}

export async function getBackup(guildId: string, id: string): Promise<ServerBackup | null> {
  const supabaseBackup = await fetchBackupFromSupabaseById(id);
  if (supabaseBackup && supabaseBackup.guildId === guildId) return supabaseBackup;
  const store = await load();
  return (store.guilds[guildId] ?? []).find((b) => b.id === id) ?? null;
}

export async function getBackupById(id: string): Promise<ServerBackup | null> {
  const supabaseBackup = await fetchBackupFromSupabaseById(id);
  if (supabaseBackup) return supabaseBackup;
  const store = await load();
  for (const guildId of Object.keys(store.guilds)) {
    const backup = store.guilds[guildId].find((b) => b.id === id);
    if (backup) return backup;
  }
  return null;
}

export async function purgeBackupsForGuild(guildId: string): Promise<void> {
  const store = await load();
  if (store.guilds[guildId]) {
    delete store.guilds[guildId];
    queueWrite(store);
  }
  await deleteBackupsForGuildSupabase(guildId);
}

export function startAutoBackupScheduler(): void {
  if (autoBackupStarted) return;
  autoBackupStarted = true;

  const tick = async () => {
    try {
      const store = await load();
      for (const guildId of Object.keys(store.guilds)) {
        const guild = (globalThis as any).__discordClient?.guilds.cache.get(guildId) ?? null;
        if (!guild) continue;
        await takeBackup(guild, "periodic").catch(() => {});
      }
    } catch (err) {
      logger.warn({ err }, "serverBackup: auto backup tick failed");
    }
  };

  void tick();
  setInterval(() => void tick(), 12 * 60 * 60 * 1000).unref();
}

export interface TakeBackupOptions {
  includeMessages?: boolean;
}

export async function takeBackup(
  guild: Guild,
  trigger: ServerBackup["trigger"],
  options?: TakeBackupOptions,
): Promise<ServerBackup> {
  const includeMessages = options?.includeMessages ?? false;
  const store = await load();
  const existing = store.guilds[guild.id] ?? [];
  const id = generateUniqueBackupId();
  const roles = await guild.roles.fetch().catch(() => null);
  const channels = await guild.channels.fetch().catch(() => null);
  const members = await guild.members.fetch().catch(() => null);

  const backupRoles: BackupRole[] = [];
  if (roles) {
    for (const role of roles.values()) {
      if (!role || role.managed || role.name === "@everyone") continue;
      backupRoles.push({
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: role.permissions.bitfield.toString(),
        position: role.position,
      });
    }
    backupRoles.sort((a, b) => a.position - b.position);
  }

  const memberRoles: BackupMemberRole[] = [];
  if (members) {
    for (const member of members.values()) {
      if (member.user.bot) continue;
      memberRoles.push({
        userId: member.id,
        roleIds: [...member.roles.cache.values()]
          .map((r) => r.id)
          .filter((id) => id !== guild.id),
      });
    }
  }

  const backupChannels: BackupChannel[] = [];
  if (channels) {
    for (const ch of channels.values()) {
      if (!ch) continue;
      const overwrites: BackupPermOverwrite[] = [];
      if ("permissionOverwrites" in ch) {
        for (const ow of (ch as any).permissionOverwrites.cache.values()) {
          overwrites.push({
            id: ow.id,
            type: ow.type as OverwriteType,
            allow: ow.allow.bitfield.toString(),
            deny: ow.deny.bitfield.toString(),
          });
        }
      }
      const bc: BackupChannel = {
        id: ch.id,
        name: ch.name,
        type: ch.type,
        position: ch.position,
        permissionOverwrites: overwrites,
      };
      if ("topic" in ch && (ch as any).topic) bc.topic = (ch as any).topic;
      if ("nsfw" in ch && (ch as any).nsfw) bc.nsfw = (ch as any).nsfw;
      if ("rateLimitPerUser" in ch && (ch as any).rateLimitPerUser > 0) bc.rateLimitPerUser = (ch as any).rateLimitPerUser;
      if ("parent" in ch && (ch as any).parent) bc.parentId = (ch as any).parent.id;

      if (includeMessages && ch.type === ChannelType.GuildText && "messages" in ch) {
        try {
          const messages = await (ch as any).messages.fetch({ limit: 100 }).catch(() => null);
          if (messages) {
            bc.messages = Array.from(messages.values())
              .reverse() // Oldest first
              .map((msg: any) => ({
                id: msg.id,
                content: msg.content,
                authorId: msg.author.id,
                authorName: msg.author.displayName || msg.author.username,
                authorAvatar: msg.author.displayAvatarURL({ size: 64 }),
                timestamp: msg.createdTimestamp,
                attachments: msg.attachments.map((att: any) => ({
                  name: att.name,
                  url: att.url,
                })),
                embeds: msg.embeds.map((emb: any) => emb.toJSON()),
              }));
          }
        } catch (err) {
          logger.warn({ err, channelId: ch.id }, "serverBackup: failed to fetch messages");
        }
      }

      backupChannels.push(bc);
    }
  }

  const bots: BackupBotPresence[] = [];
  if (members) {
    for (const member of members.values()) {
      if (member.user.bot) bots.push({ userId: member.id, botTag: member.user.tag });
    }
  }

  const backup: ServerBackup = {
    id,
    takenAt: Date.now(),
    trigger,
    guildId: guild.id,
    guildName: guild.name,
    guildIcon: guild.iconURL({ size: 256 }) ?? null,
    roles: backupRoles,
    memberRoles,
    channels: backupChannels,
    bots,
    settings: {
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      systemChannelId: guild.systemChannelId ?? undefined,
    },
  };

  existing.push(backup);
  store.guilds[guild.id] = existing.sort((a, b) => b.takenAt - a.takenAt).slice(-MAX_BACKUPS_PER_GUILD);
  queueWrite(store);
  await saveBackupToSupabase(backup);
  logger.info({ guildId: guild.id, guildName: guild.name, backupId: id, trigger }, "serverBackup: snapshot taken");
  return backup;
}

export async function restoreBackup(guild: Guild, backup: ServerBackup): Promise<{ rolesCreated: number; channelsCreated: number; memberRolesRestored: number; errors: string[] }> {
  const errors: string[] = [];
  let rolesCreated = 0;
  let channelsCreated = 0;
  let memberRolesRestored = 0;
  const roleMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();

  for (const r of guild.roles.cache.values()) roleMap.set(r.name, r.id);

  for (const br of backup.roles) {
    const existing = guild.roles.cache.find((r) => r.name === br.name);
    if (existing) {
      roleMap.set(br.name, existing.id);
      continue;
    }
    try {
      const created = await guild.roles.create({
        name: br.name,
        color: br.color,
        hoist: br.hoist,
        mentionable: br.mentionable,
        permissions: BigInt(br.permissions),
        reason: `Relosta Bot restore from backup #${backup.id}`,
      });
      roleMap.set(br.name, created.id);
      rolesCreated++;
    } catch (err) {
      errors.push(`Role "${br.name}": ${(err as Error).message}`);
    }
  }

  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildCategory) categoryMap.set(ch.name, ch.id);
  }

  for (const bc of backup.channels.filter((c) => c.type === ChannelType.GuildCategory)) {
    const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === bc.name);
    if (existing) {
      categoryMap.set(bc.name, existing.id);
      continue;
    }
    try {
      const created = await guild.channels.create({ name: bc.name, type: ChannelType.GuildCategory, position: bc.position, reason: `Relosta Bot restore from backup #${backup.id}` });
      categoryMap.set(bc.name, created.id);
      channelsCreated++;
    } catch (err) {
      errors.push(`Category "${bc.name}": ${(err as Error).message}`);
    }
  }

  for (const bc of backup.channels.filter((c) => c.type !== ChannelType.GuildCategory)) {
    if (guild.channels.cache.some((c) => c.name === bc.name && c.type === bc.type)) continue;
    const parentId = bc.parentId ? (guild.channels.cache.get(bc.parentId)?.id ?? categoryMap.get(backup.channels.find((c) => c.id === bc.parentId)?.name ?? "") ?? undefined) : undefined;
    const permOverwrites = bc.permissionOverwrites.map((ow) => ({ id: roleMap.get(guild.roles.cache.get(ow.id)?.name ?? "") ?? ow.id, type: ow.type, allow: BigInt(ow.allow), deny: BigInt(ow.deny) }));
    try {
      let createdChannel;
      if (bc.type === ChannelType.GuildText || bc.type === ChannelType.GuildAnnouncement) {
        createdChannel = await guild.channels.create({ name: bc.name, type: bc.type as ChannelType.GuildText | ChannelType.GuildAnnouncement, parent: parentId, position: bc.position, topic: bc.topic, nsfw: bc.nsfw, rateLimitPerUser: bc.rateLimitPerUser, permissionOverwrites: permOverwrites, reason: `Relosta Bot restore from backup #${backup.id}` });
      } else if (bc.type === ChannelType.GuildVoice || bc.type === ChannelType.GuildStageVoice) {
        createdChannel = await guild.channels.create({ name: bc.name, type: bc.type as ChannelType.GuildVoice | ChannelType.GuildStageVoice, parent: parentId, position: bc.position, permissionOverwrites: permOverwrites, reason: `Relosta Bot restore from backup #${backup.id}` });
      } else if (bc.type === ChannelType.GuildForum) {
        createdChannel = await guild.channels.create({ name: bc.name, type: ChannelType.GuildForum, parent: parentId, position: bc.position, permissionOverwrites: permOverwrites, reason: `Relosta Bot restore from backup #${backup.id}` });
      }
      channelsCreated++;

      // Restore messages if this is a text channel with messages
      if (createdChannel && bc.messages && bc.messages.length > 0 && createdChannel.type === ChannelType.GuildText) {
        try {
          for (const msg of bc.messages) {
            const content = `**${msg.authorName}** (${msg.authorId})\n${msg.content || "*No content*"}`;
            await createdChannel.send({
              content,
              embeds: msg.embeds,
              files: msg.attachments.map(att => ({ name: att.name, attachment: att.url })),
            });
            // Small delay to avoid rate limits
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (err) {
          errors.push(`Messages in "${bc.name}": ${(err as Error).message}`);
        }
      }
    } catch (err) {
      errors.push(`Channel "${bc.name}": ${(err as Error).message}`);
    }
  }

  const memberMap = new Map(backup.memberRoles.map((m) => [m.userId, m.roleIds]));
  for (const [userId, roleIds] of memberMap) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    for (const roleId of roleIds) {
      const roleName = backup.roles.find((r) => r.id === roleId)?.name;
      const liveRoleId = roleName ? roleMap.get(roleName) : null;
      if (!liveRoleId) continue;
      if (!member.roles.cache.has(liveRoleId)) {
        await member.roles.add(liveRoleId, `Relosta Bot restore from backup #${backup.id}`).catch(() => {});
        memberRolesRestored++;
      }
    }
  }

  logger.info({ guildId: guild.id, backupId: backup.id, rolesCreated, channelsCreated, memberRolesRestored, errors: errors.length }, "serverBackup: restore complete");
  return { rolesCreated, channelsCreated, memberRolesRestored, errors };
}