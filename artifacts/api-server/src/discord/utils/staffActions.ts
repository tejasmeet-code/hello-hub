import type { Client, Guild, GuildMember } from "discord.js";
import { logger } from "../../lib/logger";
import { getConnectedGuildId } from "../storage/connections";
import {
  activeStrikes,
  expireActiveStrikes,
  getProfile,
  listStaffRoles,
  recordDemotion,
  recordInfraction,
  syncProfileFromMember,
} from "../storage/staff";
import { propagateRoleAssignment } from "./crossServer";

/** Remove every registered staff role from a member in this guild. */
export async function terminateInGuild(
  guild: Guild,
  member: GuildMember,
  reason: string,
): Promise<string[]> {
  const roles = await listStaffRoles(guild.id);
  const removed: string[] = [];
  for (const r of roles) {
    if (member.roles.cache.has(r.roleId)) {
      try {
        await member.roles.remove(r.roleId, reason);
        removed.push(r.roleId);
      } catch (err) {
        logger.warn(
          { err, roleId: r.roleId },
          "terminateInGuild: failed to remove role",
        );
      }
    }
  }
  return removed;
}

/** Mirror a termination to the connected server: remove all staff roles there. */
export async function propagateTermination(
  client: Client,
  sourceGuild: Guild,
  userId: string,
  reason: string,
): Promise<{
  propagated: boolean;
  otherGuildId?: string;
  removed: number;
  note?: string;
}> {
  const link = await getConnectedGuildId(sourceGuild.id);
  if (!link) return { propagated: false, removed: 0 };
  const targetGuild = await client.guilds
    .fetch(link.otherGuildId)
    .catch(() => null);
  if (!targetGuild) {
    return {
      propagated: false,
      otherGuildId: link.otherGuildId,
      removed: 0,
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
      removed: 0,
      note: "User isn't in the connected server.",
    };
  }
  const removed = await terminateInGuild(targetGuild, targetMember, reason);
  await syncProfileFromMember(link.otherGuildId, targetMember);
  return {
    propagated: true,
    otherGuildId: link.otherGuildId,
    removed: removed.length,
  };
}

export interface AutoDemotionResult {
  triggered: boolean;
  isTermination?: boolean;
  fromRoleId?: string;
  toRoleId?: string | null;
  activeStrikeCount?: number;
  clearedStrikes?: number;
  otherGuildId?: string;
  propagated?: boolean;
  propagationNote?: string;
}

/**
 * If the user now has 3+ active strikes, automatically demote them one step
 * (or terminate if they're at the lowest staff role), expire all active
 * strikes, and mirror the change to the connected server.
 */
export async function autoDemoteForActiveStrikes(
  client: Client,
  guild: Guild,
  member: GuildMember,
  byUserId: string,
  baseReason: string,
): Promise<AutoDemotionResult> {
  await syncProfileFromMember(guild.id, member);
  const profile = await getProfile(guild.id, member.id);
  if (!profile) return { triggered: false };

  const active = activeStrikes(profile.infractions);
  if (active.length < 3) return { triggered: false };

  const roles = await listStaffRoles(guild.id);
  if (roles.length === 0) return { triggered: false };
  const heldEntry =
    roles.find((r) => member.roles.cache.has(r.roleId)) ?? null;
  if (!heldEntry) return { triggered: false };

  const lowestPos = Math.max(...roles.map((r) => r.position));
  const isTermination = heldEntry.position === lowestPos;
  const targetEntry = isTermination
    ? null
    : (roles.find((r) => r.position === heldEntry.position + 1) ?? null);
  if (!isTermination && !targetEntry) return { triggered: false };

  const reason = `Auto-demotion: ${active.length} active strikes. ${baseReason}`.slice(
    0,
    480,
  );
  let propagated = false;
  let propagationNote: string | undefined;
  let otherGuildId: string | undefined;

  try {
    if (isTermination) {
      await terminateInGuild(guild, member, reason);
      const cross = await propagateTermination(client, guild, member.id, reason);
      propagated = cross.propagated;
      propagationNote = cross.note;
      otherGuildId = cross.otherGuildId;
    } else {
      await member.roles.remove(heldEntry.roleId, reason);
      await member.roles.add(targetEntry!.roleId, reason);
      const cross = await propagateRoleAssignment(
        client,
        guild,
        member.id,
        targetEntry!.roleId,
        heldEntry.roleId,
        reason,
      );
      propagated = cross.propagated;
      propagationNote = cross.note;
      otherGuildId = cross.otherGuildId;
    }
  } catch (err) {
    logger.warn({ err }, "autoDemote: role change failed");
  }

  await recordDemotion(
    guild.id,
    member.id,
    heldEntry.roleId,
    targetEntry?.roleId ?? null,
    byUserId,
    reason,
  );
  await recordInfraction(
    guild.id,
    member.id,
    isTermination ? "termination" : "demotion",
    byUserId,
    reason,
  );
  const cleared = await expireActiveStrikes(guild.id, member.id);
  await syncProfileFromMember(guild.id, member);

  return {
    triggered: true,
    isTermination,
    fromRoleId: heldEntry.roleId,
    toRoleId: targetEntry?.roleId ?? null,
    activeStrikeCount: active.length,
    clearedStrikes: cleared,
    otherGuildId,
    propagated,
    propagationNote,
  };
}
