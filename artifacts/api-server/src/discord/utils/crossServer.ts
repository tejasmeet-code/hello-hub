import {
  ChannelType,
  type Client,
  type EmbedBuilder,
  type Guild,
  type GuildTextBasedChannel,
} from "discord.js";
import { logger } from "../../lib/logger";
import { getConnectedGuildId, getConnectionsByGuild } from "../storage/connections";
import { getGuildConfig } from "../storage/config";
import { ensureJailRole, applyJailToMember } from "../storage/jail";
import {
  getProfile,
  getRoleEntry,
  listStaffRoles,
  syncProfileFromMember,
} from "../storage/staff";

/**
 * Given a position number in `sourceGuild`, find the equivalent staff role in
 * `targetGuild`. Tries by exact position first, then by matching role name.
 */
async function resolveTargetRoleId(
  sourceGuild: Guild,
  sourceRoleId: string,
  targetGuildId: string,
  client: Client,
): Promise<string | null> {
  const sourcePos = await getRoleEntry(sourceGuild.id, sourceRoleId);
  if (!sourcePos) return null;
  const targetRoles = await listStaffRoles(targetGuildId);
  const byPos = targetRoles.find((r) => r.position === sourcePos.position);
  if (byPos) return byPos.roleId;

  // Fall back to matching by name.
  const sourceRole = await sourceGuild.roles.fetch(sourceRoleId).catch(() => null);
  if (!sourceRole) return null;
  const targetGuild = await client.guilds.fetch(targetGuildId).catch(() => null);
  if (!targetGuild) return null;
  for (const r of targetRoles) {
    const role = await targetGuild.roles.fetch(r.roleId).catch(() => null);
    if (role && role.name.toLowerCase() === sourceRole.name.toLowerCase()) {
      return r.roleId;
    }
  }
  return null;
}

/**
 * Propagate a role assignment to the connected server. Best-effort: errors are
 * logged and swallowed so the primary command flow isn't blocked.
 */
export async function propagateRoleAssignment(
  client: Client,
  sourceGuild: Guild,
  userId: string,
  newRoleId: string | null,
  removeRoleId: string | null,
  reason: string,
): Promise<{ propagated: boolean; otherGuildId?: string; note?: string }> {
  const link = await getConnectedGuildId(sourceGuild.id);
  if (!link) return { propagated: false };

  const targetGuild = await client.guilds
    .fetch(link.otherGuildId)
    .catch(() => null);
  if (!targetGuild) {
    return {
      propagated: false,
      otherGuildId: link.otherGuildId,
      note: "Bot isn't in the connected server.",
    };
  }
  const targetMember = await targetGuild.members
    .fetch(userId)
    .catch(() => null);
  if (!targetMember) {
    return {
      propagated: false,
      otherGuildId: link.otherGuildId,
      note: "User isn't in the connected server.",
    };
  }

  try {
    if (removeRoleId) {
      const tRemoveId = await resolveTargetRoleId(
        sourceGuild,
        removeRoleId,
        link.otherGuildId,
        client,
      );
      if (tRemoveId) {
        await targetMember.roles.remove(tRemoveId, reason).catch((err) => {
          logger.warn({ err }, "cross-server: failed to remove role");
        });
      }
    }
    if (newRoleId) {
      const tNewId = await resolveTargetRoleId(
        sourceGuild,
        newRoleId,
        link.otherGuildId,
        client,
      );
      if (tNewId) {
        await targetMember.roles.add(tNewId, reason).catch((err) => {
          logger.warn({ err }, "cross-server: failed to add role");
        });
      } else {
        return {
          propagated: false,
          otherGuildId: link.otherGuildId,
          note: "Couldn't find a matching staff role in the connected server.",
        };
      }
    }
    // Sync profile in target.
    await syncProfileFromMember(link.otherGuildId, targetMember);
    return { propagated: true, otherGuildId: link.otherGuildId };
  } catch (err) {
    logger.warn({ err }, "cross-server: propagation failed");
    return {
      propagated: false,
      otherGuildId: link.otherGuildId,
      note: "Propagation error.",
    };
  }
}

/**
 * Mirror a promotion/demotion announcement embed to the connected server's
 * configured `promotions` or `demotions` channel. Best-effort: silently
 * returns a status without throwing.
 */
export async function mirrorAnnouncementToConnected(
  client: Client,
  sourceGuild: Guild,
  embed: EmbedBuilder,
  purpose: "promotions" | "demotions",
): Promise<{ mirrored: boolean; otherGuildId?: string; note?: string }> {
  const link = await getConnectedGuildId(sourceGuild.id);
  if (!link) return { mirrored: false };

  const targetGuild = await client.guilds
    .fetch(link.otherGuildId)
    .catch(() => null);
  if (!targetGuild) {
    return {
      mirrored: false,
      otherGuildId: link.otherGuildId,
      note: "Bot isn't in the connected server.",
    };
  }

  const otherCfg = await getGuildConfig(link.otherGuildId);
  const channelId = otherCfg.channels[purpose];
  if (!channelId) {
    return {
      mirrored: false,
      otherGuildId: link.otherGuildId,
      note: `Connected server has no ${purpose} channel set.`,
    };
  }
  const ch = await targetGuild.channels.fetch(channelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText || !("send" in ch)) {
    return {
      mirrored: false,
      otherGuildId: link.otherGuildId,
      note: `Configured ${purpose} channel is not accessible.`,
    };
  }
  try {
    await (ch as GuildTextBasedChannel).send({ embeds: [embed] });
    return { mirrored: true, otherGuildId: link.otherGuildId };
  } catch (err) {
    logger.warn({ err, purpose }, "cross-server: mirror announce failed");
    return {
      mirrored: false,
      otherGuildId: link.otherGuildId,
      note: "Send failed in connected server.",
    };
  }
}

/**
 * Try to find a connected appeals server and generate a short-lived invite
 * from it. Returns the invite URL, or null if none could be produced.
 * Used so ban DMs always include an appeal server link even when admins
 * haven't manually set `appealServerInvite` in config.
 */
export async function getAppealsInvite(
  client: Client,
  sourceGuildId: string,
): Promise<string | null> {
  const connections = await getConnectionsByGuild(sourceGuildId);
  for (const { conn, otherGuildId } of connections) {
    // Determine the other guild's role in this connection
    const otherRole = conn.guildAId === sourceGuildId ? conn.guildBRole : conn.guildARole;
    if (otherRole !== "appeals") continue;

    const appealsGuild = await client.guilds.fetch(otherGuildId).catch(() => null);
    if (!appealsGuild) continue;

    // Try to find a text channel and generate a 24-hour invite
    const textChannel = appealsGuild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && ("permissionsFor" in c),
    );
    if (!textChannel) continue;

    const inv = await (textChannel as any)
      .createInvite({ maxAge: 86_400, maxUses: 0, reason: "Ban DM — appeal link" })
      .catch(() => null);
    if (inv?.url) return inv.url as string;
  }
  return null;
}

export async function profileExists(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const p = await getProfile(guildId, userId);
  return p !== null;
}

export interface PropagationResult {
  guildName: string;
  success: boolean;
  note?: string;
}

/**
 * Propagate a punishment (ban / mute / jail / kick) to ALL servers connected
 * to `sourceGuildId`. Best-effort — errors are captured in the result array
 * and never thrown.
 */
export async function propagatePunishment(
  client: Client,
  sourceGuildId: string,
  opts: {
    type: "ban" | "mute" | "kick" | "jail";
    userId: string;
    reason: string;
    durationMs?: number;
  },
): Promise<PropagationResult[]> {
  const connections = await getConnectionsByGuild(sourceGuildId);
  if (connections.length === 0) return [];

  const results: PropagationResult[] = [];

  for (const { otherGuildId } of connections) {
    const targetGuild = await client.guilds.fetch(otherGuildId).catch(() => null);
    const guildName = targetGuild?.name ?? `Guild ${otherGuildId}`;

    if (!targetGuild) {
      results.push({ guildName, success: false, note: "Bot not in server" });
      continue;
    }

    try {
      if (opts.type === "ban") {
        await targetGuild.members.ban(opts.userId, {
          reason: `[Cross-server] ${opts.reason}`,
        });
        results.push({ guildName, success: true });
      } else if (opts.type === "kick") {
        const member = await targetGuild.members.fetch(opts.userId).catch(() => null);
        if (!member) { results.push({ guildName, success: false, note: "Not in server" }); continue; }
        await member.kick(`[Cross-server] ${opts.reason}`);
        results.push({ guildName, success: true });
      } else if (opts.type === "mute") {
        const member = await targetGuild.members.fetch(opts.userId).catch(() => null);
        if (!member) { results.push({ guildName, success: false, note: "Not in server" }); continue; }
        if (!member.moderatable) { results.push({ guildName, success: false, note: "No permission" }); continue; }
        await member.timeout(opts.durationMs ?? 60_000, `[Cross-server] ${opts.reason}`);
        results.push({ guildName, success: true });
      } else if (opts.type === "jail") {
        const member = await targetGuild.members.fetch(opts.userId).catch(() => null);
        if (!member) { results.push({ guildName, success: false, note: "Not in server" }); continue; }
        if (!member.manageable) { results.push({ guildName, success: false, note: "No permission" }); continue; }
        const jailRoleId = await ensureJailRole(targetGuild);
        if (!jailRoleId) { results.push({ guildName, success: false, note: "Cannot create Jailed role" }); continue; }
        const me = targetGuild.members.me;
        if (!me) { results.push({ guildName, success: false, note: "Bot member unavailable" }); continue; }
        await applyJailToMember(member, jailRoleId, me, `[Cross-server] ${opts.reason}`);
        results.push({ guildName, success: true });
      }
    } catch (err) {
      logger.warn({ err, otherGuildId, type: opts.type }, "propagatePunishment: failed");
      results.push({ guildName, success: false, note: "Unexpected error" });
    }
  }

  return results;
}

/**
 * Format cross-server propagation results into a single bullet value string.
 * Returns null if there were no connected servers.
 */
export function formatPropagationResults(results: PropagationResult[]): string | null {
  if (results.length === 0) return null;
  return results
    .map((r) => r.success ? `✓ ${r.guildName}` : `✗ ${r.guildName}${r.note ? ` (${r.note})` : ""}`)
    .join(", ");
}

/**
 * When a ban fires via the GuildBanAdd event (admin ban, not from this bot),
 * propagate it to every connected server. Skips guilds that already have the
 * user banned. Best-effort — errors never throw.
 */
export async function propagateNativeBan(
  client: Client,
  sourceGuildId: string,
  userId: string,
  sourceGuildName: string,
  reason: string | null,
): Promise<void> {
  const connections = await getConnectionsByGuild(sourceGuildId);
  if (connections.length === 0) return;

  for (const { otherGuildId } of connections) {
    const targetGuild = await client.guilds.fetch(otherGuildId).catch(() => null);
    if (!targetGuild) continue;

    try {
      // Check if already banned to avoid a Discord error
      const existing = await targetGuild.bans.fetch(userId).catch(() => null);
      if (existing) continue;

      await targetGuild.members.ban(userId, {
        reason: `[Cross-server ban from ${sourceGuildName}] ${reason ?? "No reason provided"}`,
      });
      logger.info({ sourceGuildId, otherGuildId, userId }, "cross-server: native ban propagated");
    } catch (err) {
      logger.warn({ err, otherGuildId, userId }, "cross-server: native ban propagation failed");
    }
  }
}

/**
 * Mirror the bot's nickname from the source guild to every connected server.
 * Used when an admin changes the bot's server nickname in one place.
 */
export async function syncBotNicknameToConnected(
  client: Client,
  sourceGuildId: string,
  nickname: string | null,
): Promise<void> {
  const connections = await getConnectionsByGuild(sourceGuildId);
  if (connections.length === 0) return;

  for (const { otherGuildId } of connections) {
    try {
      const guild = await client.guilds.fetch(otherGuildId).catch(() => null);
      if (!guild) continue;
      const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
      if (!me) continue;
      await me.setNickname(nickname, `Nickname synced from ${sourceGuildId}`);
      logger.info({ sourceGuildId, otherGuildId, nickname }, "cross-server: bot nickname synced");
    } catch (err) {
      logger.warn({ err, otherGuildId }, "cross-server: bot nickname sync failed");
    }
  }
}
