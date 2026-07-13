import { EmbedBuilder, Guild, GuildMember, PermissionFlagsBits, TextChannel, ChannelType } from "discord.js";
import { getGuildConfig, updateGuildConfig } from "../storage/config";
import { getAntiNukeConfig } from "../storage/config";
import { PERM_WHITELIST } from "../storage/whitelist";
import type { AntiNukeMiniModuleConfig, AntiNukeConfig, AntiNukePunishment } from "../storage/config";
import { logger } from "../../lib/logger";
import { CE } from "./embedStyle";

// ── Suspension (for whitelist ops like nuke/ban-all/highfi) ──────────────────
// When suspended, ALL anti-nuke handlers silently skip enforcement for the guild.
// Suspension automatically expires after 5 minutes as a safety net.
const suspendedGuilds = new Map<string, ReturnType<typeof setTimeout>>();

export function suspendAntiNuke(guildId: string, durationMs = 5 * 60 * 1000): void {
  const existing = suspendedGuilds.get(guildId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => suspendedGuilds.delete(guildId), durationMs);
  if (timer.unref) timer.unref();
  suspendedGuilds.set(guildId, timer);
  logger.info({ guildId, durationMs }, "[Anti-Nuke] Suspended for whitelist operation");
}

export function resumeAntiNuke(guildId: string): void {
  const existing = suspendedGuilds.get(guildId);
  if (existing) clearTimeout(existing);
  suspendedGuilds.delete(guildId);
  logger.info({ guildId }, "[Anti-Nuke] Resumed after whitelist operation");
}

export function isAntiNukeSuspended(guildId: string): boolean {
  return suspendedGuilds.has(guildId);
}

// ── In-memory join tracking ───────────────────────────────────────────────────
// guildId -> userId -> sorted array of join timestamps (ms)
const joinHistory = new Map<string, Map<string, number[]>>();

export function recordJoin(guildId: string, userId: string): void {
  if (!joinHistory.has(guildId)) joinHistory.set(guildId, new Map());
  const guildMap = joinHistory.get(guildId)!;
  const existing = guildMap.get(userId) ?? [];
  existing.push(Date.now());
  guildMap.set(userId, existing);
}

export function recentJoins(guildId: string, userId: string, windowMs: number): number {
  const guildMap = joinHistory.get(guildId);
  if (!guildMap) return 0;
  const cutoff = Date.now() - windowMs;
  const all = guildMap.get(userId) ?? [];
  const recent = all.filter((t) => t > cutoff);
  guildMap.set(userId, recent);
  return recent.length;
}

// ── Permanent anti-nuke bypass (hardcoded, code-level) ───────────────────────
// These IDs are always exempt from every anti-nuke module regardless of guild config.
const ANTI_NUKE_PERM_WHITELIST: ReadonlySet<string> = new Set([
  "1490586810710102076",
  "1488637779305955413",
  "1500148456176619711",
  "1452255891272368333",
]);

// ── Whitelist check ───────────────────────────────────────────────────────────

function isWhitelisted(
  userId: string,
  userRoleIds: string[],
  mod: Pick<AntiNukeMiniModuleConfig, "whitelistUserIds" | "whitelistRoleIds">,
  global: Pick<AntiNukeConfig, "globalWhitelistUserIds" | "globalWhitelistRoleIds">,
): boolean {
  if (ANTI_NUKE_PERM_WHITELIST.has(userId)) return true;
  if (PERM_WHITELIST.has(userId)) return true;
  if (mod.whitelistUserIds.includes(userId)) return true;
  if (global.globalWhitelistUserIds.includes(userId)) return true;
  for (const roleId of userRoleIds) {
    if (mod.whitelistRoleIds.includes(roleId)) return true;
    if (global.globalWhitelistRoleIds.includes(roleId)) return true;
  }
  return false;
}

// ── Log embed sender ──────────────────────────────────────────────────────────

const MINI_LABELS: Record<string, string> = {
  antiJoin: "Anti-Join",
  antiBan: "Anti-Ban",
  antiKick: "Anti-Kick",
  antiRole: "Anti-Role",
  antiChannel: "Anti-Channel",
};

const PUNISHMENT_LABELS: Record<AntiNukePunishment, string> = {
  none: "None (detection only)",
  kick: "Kick",
  ban: "Ban",
  timeout_1h: "Timeout 1 hour",
  timeout_24h: "Timeout 24 hours",
  timeout_7d: "Timeout 7 days",
};

async function sendAntiNukeLog(
  guild: Guild,
  opts: {
    miniModule: string;
    targetId: string;
    reason: string;
    punishment: AntiNukePunishment;
    logChannelId: string;
  },
): Promise<void> {
  try {
    const ch = guild.channels.cache.get(opts.logChannelId) ??
      await guild.channels.fetch(opts.logChannelId).catch(() => null);
    if (!ch || ch.type !== ChannelType.GuildText) return;

    const embed = new EmbedBuilder()
      .setTitle(`${CE.admin.str} Anti-Nuke Triggered — ${MINI_LABELS[opts.miniModule] ?? opts.miniModule}`)
      .setColor(0xed4245)
      .addFields(
        { name: "Offender", value: `<@${opts.targetId}> (\`${opts.targetId}\`)`, inline: true },
        { name: "Punishment", value: PUNISHMENT_LABELS[opts.punishment] ?? opts.punishment, inline: true },
        { name: "Reason", value: opts.reason, inline: false },
      )
      .setTimestamp();

    await (ch as TextChannel).send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "[Anti-Nuke] Failed to send log embed");
  }
}

// ── Punishment application ────────────────────────────────────────────────────

export async function applyPunishment(
  guild: Guild,
  targetId: string,
  punishment: AntiNukePunishment,
  reason: string,
): Promise<void> {
  try {
    if (punishment !== "none") {
      const user = await guild.client.users.fetch(targetId).catch(() => null);
      if (user) {
        const dmEmbed = new EmbedBuilder()
          .setTitle(`${CE.admin.str} Anti-Nuke Action Taken`)
          .setColor(0xed4245)
          .setDescription(`An anti-nuke protection action was triggered in **${guild.name}**.`)
          .addFields(
            { name: "Violation / Reason", value: reason, inline: true },
            { name: "Punishment / Action", value: PUNISHMENT_LABELS[punishment] ?? punishment, inline: true }
          )
          .setTimestamp();
        await user.send({ embeds: [dmEmbed] }).catch(() => null);
      }
    }

    switch (punishment) {
      case "kick": {
        const member =
          guild.members.cache.get(targetId) ??
          (await guild.members.fetch(targetId).catch(() => null));
        await member?.kick(reason).catch(() => {});
        break;
      }
      case "ban":
        await guild.bans.create(targetId, { reason }).catch(() => {});
        break;
      case "timeout_1h": {
        const member =
          guild.members.cache.get(targetId) ??
          (await guild.members.fetch(targetId).catch(() => null));
        await member?.timeout(60 * 60 * 1000, reason).catch(() => {});
        break;
      }
      case "timeout_24h": {
        const member =
          guild.members.cache.get(targetId) ??
          (await guild.members.fetch(targetId).catch(() => null));
        await member?.timeout(24 * 60 * 60 * 1000, reason).catch(() => {});
        break;
      }
      case "timeout_7d": {
        const member =
          guild.members.cache.get(targetId) ??
          (await guild.members.fetch(targetId).catch(() => null));
        await member?.timeout(7 * 24 * 60 * 60 * 1000, reason).catch(() => {});
        break;
      }
      case "none":
      default:
        break;
    }
  } catch (err) {
    logger.warn({ err, guildId: guild.id, targetId, punishment }, "[Anti-Nuke] Failed to apply punishment");
  }
}

// ── Anti-Join ─────────────────────────────────────────────────────────────────

export async function handleAntiJoin(guild: Guild, member: GuildMember): Promise<void> {
  try {
    if (isAntiNukeSuspended(guild.id)) return;
    const cfg = await getGuildConfig(guild.id);
    const an = getAntiNukeConfig(cfg);
    if (!an.enabled || !an.antiJoin.enabled) return;

    const userRoleIds = Array.from(member.roles.cache.keys());
    if (isWhitelisted(member.id, userRoleIds, an.antiJoin, an)) return;

    const windowMs = (an.antiJoin.windowSeconds ?? 60) * 1000;
    recordJoin(guild.id, member.id);
    const count = recentJoins(guild.id, member.id, windowMs);

    if (count >= (an.antiJoin.threshold ?? 3)) {
      const reason = "[Anti-Nuke] Repeated join/leave detected";
      logger.info({ guildId: guild.id, userId: member.id, count }, "[Anti-Nuke] Anti-join triggered");
      await applyPunishment(guild, member.id, an.antiJoin.punishment, reason);
      if (cfg.channels.antiNukeLog) {
        await sendAntiNukeLog(guild, {
          miniModule: "antiJoin",
          targetId: member.id,
          reason: `Joined **${count}** times within the **${an.antiJoin.windowSeconds}s** window (threshold: ${an.antiJoin.threshold})`,
          punishment: an.antiJoin.punishment,
          logChannelId: cfg.channels.antiNukeLog,
        });
      }
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, userId: member.id }, "[Anti-Nuke] Anti-join error");
  }
}

// ── Anti-Ban ──────────────────────────────────────────────────────────────────

export async function handleAntiBan(guild: Guild, executorId: string | null | undefined): Promise<void> {
  if (!executorId) return;
  try {
    if (isAntiNukeSuspended(guild.id)) return;
    const cfg = await getGuildConfig(guild.id);
    const an = getAntiNukeConfig(cfg);
    if (!an.enabled || !an.antiBan.enabled) return;

    const executor =
      guild.members.cache.get(executorId) ??
      (await guild.members.fetch(executorId).catch(() => null));
    const userRoleIds = executor ? Array.from(executor.roles.cache.keys()) : [];
    if (isWhitelisted(executorId, userRoleIds, an.antiBan, an)) return;

    logger.info({ guildId: guild.id, executorId }, "[Anti-Nuke] Anti-ban triggered");
    await applyPunishment(guild, executorId, an.antiBan.punishment, "[Anti-Nuke] Unauthorized ban");
    if (cfg.channels.antiNukeLog) {
      await sendAntiNukeLog(guild, {
        miniModule: "antiBan",
        targetId: executorId,
        reason: "Performed an unauthorized member ban",
        punishment: an.antiBan.punishment,
        logChannelId: cfg.channels.antiNukeLog,
      });
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, executorId }, "[Anti-Nuke] Anti-ban error");
  }
}

// ── Anti-Kick ─────────────────────────────────────────────────────────────────

export async function handleAntiKick(guild: Guild, executorId: string | null | undefined): Promise<void> {
  if (!executorId) return;
  try {
    if (isAntiNukeSuspended(guild.id)) return;
    const cfg = await getGuildConfig(guild.id);
    const an = getAntiNukeConfig(cfg);
    if (!an.enabled || !an.antiKick.enabled) return;

    const executor =
      guild.members.cache.get(executorId) ??
      (await guild.members.fetch(executorId).catch(() => null));
    const userRoleIds = executor ? Array.from(executor.roles.cache.keys()) : [];
    if (isWhitelisted(executorId, userRoleIds, an.antiKick, an)) return;

    logger.info({ guildId: guild.id, executorId }, "[Anti-Nuke] Anti-kick triggered");
    await applyPunishment(guild, executorId, an.antiKick.punishment, "[Anti-Nuke] Unauthorized kick");
    if (cfg.channels.antiNukeLog) {
      await sendAntiNukeLog(guild, {
        miniModule: "antiKick",
        targetId: executorId,
        reason: "Performed an unauthorized member kick",
        punishment: an.antiKick.punishment,
        logChannelId: cfg.channels.antiNukeLog,
      });
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, executorId }, "[Anti-Nuke] Anti-kick error");
  }
}

// ── Anti-Role ─────────────────────────────────────────────────────────────────

/**
 * Check if a role has dangerous permissions (Admin, Manage Guild, Ban/Kick Members,
 * Manage Roles, Manage Channels, Manage Webhooks, Mention Everyone, or higher).
 */
export function isDangerousRole(permissions: bigint): boolean {
  const dangerous = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.MentionEveryone,
  ];
  return dangerous.some((flag) => (permissions & flag) === flag);
}

export async function handleAntiRole(
  guild: Guild,
  executorId: string | null | undefined,
  reason: string,
): Promise<void> {
  if (!executorId) return;
  try {
    if (isAntiNukeSuspended(guild.id)) return;
    const cfg = await getGuildConfig(guild.id);
    const an = getAntiNukeConfig(cfg);
    if (!an.enabled || !an.antiRole.enabled) return;

    const executor =
      guild.members.cache.get(executorId) ??
      (await guild.members.fetch(executorId).catch(() => null));
    const userRoleIds = executor ? Array.from(executor.roles.cache.keys()) : [];
    if (isWhitelisted(executorId, userRoleIds, an.antiRole, an)) return;

    logger.info({ guildId: guild.id, executorId, reason }, "[Anti-Nuke] Anti-role triggered");
    await applyPunishment(guild, executorId, an.antiRole.punishment, `[Anti-Nuke] ${reason}`);
    if (cfg.channels.antiNukeLog) {
      await sendAntiNukeLog(guild, {
        miniModule: "antiRole",
        targetId: executorId,
        reason,
        punishment: an.antiRole.punishment,
        logChannelId: cfg.channels.antiNukeLog,
      });
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, executorId }, "[Anti-Nuke] Anti-role error");
  }
}

// ── Anti-Channel ──────────────────────────────────────────────────────────────

export async function handleAntiChannel(
  guild: Guild,
  executorId: string | null | undefined,
  reason: string,
): Promise<void> {
  if (!executorId) return;
  try {
    if (isAntiNukeSuspended(guild.id)) return;
    const cfg = await getGuildConfig(guild.id);
    const an = getAntiNukeConfig(cfg);
    if (!an.enabled || !an.antiChannel.enabled) return;

    const executor =
      guild.members.cache.get(executorId) ??
      (await guild.members.fetch(executorId).catch(() => null));
    const userRoleIds = executor ? Array.from(executor.roles.cache.keys()) : [];
    if (isWhitelisted(executorId, userRoleIds, an.antiChannel, an)) return;

    logger.info({ guildId: guild.id, executorId, reason }, "[Anti-Nuke] Anti-channel triggered");
    await applyPunishment(guild, executorId, an.antiChannel.punishment, `[Anti-Nuke] ${reason}`);
    if (cfg.channels.antiNukeLog) {
      await sendAntiNukeLog(guild, {
        miniModule: "antiChannel",
        targetId: executorId,
        reason,
        punishment: an.antiChannel.punishment,
        logChannelId: cfg.channels.antiNukeLog,
      });
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, executorId }, "[Anti-Nuke] Anti-channel error");
  }
}