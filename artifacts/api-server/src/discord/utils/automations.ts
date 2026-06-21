import {
  ChannelType,
  type Client,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type User,
} from "discord.js";
import { logger } from "../../lib/logger";
import {
  findMatchingAutomations,
  type Automation,
  type ModActionKind,
} from "../storage/automations";
import { getGuildConfig } from "../storage/config";

interface TemplateContext {
  guild: Guild;
  user?: User | GuildMember | null;
  moderator?: User | GuildMember | null;
  role?: { id: string; name: string } | null;
  reason?: string | null;
  action?: string | null;
}

function userOf(u: User | GuildMember | null | undefined): User | null {
  if (!u) return null;
  return "user" in u ? u.user : u;
}

function render(template: string, ctx: TemplateContext): string {
  const user = userOf(ctx.user);
  const mod = userOf(ctx.moderator);
  const map: Record<string, string> = {
    "{guild}": ctx.guild.name,
    "{guild.id}": ctx.guild.id,
    "{user}": user?.tag ?? "user",
    "{user.tag}": user?.tag ?? "user",
    "{user.id}": user?.id ?? "",
    "{user.mention}": user ? `<@${user.id}>` : "user",
    "{moderator}": mod?.tag ?? "moderator",
    "{moderator.mention}": mod ? `<@${mod.id}>` : "moderator",
    "{moderator.id}": mod?.id ?? "",
    "{role}": ctx.role?.name ?? "role",
    "{role.id}": ctx.role?.id ?? "",
    "{role.mention}": ctx.role ? `<@&${ctx.role.id}>` : "role",
    "{reason}": ctx.reason ?? "No reason provided",
    "{action}": ctx.action ?? "action",
  };
  let out = template;
  for (const [k, v] of Object.entries(map)) {
    out = out.split(k).join(v);
  }
  return out;
}

async function isEnabled(guildId: string): Promise<boolean> {
  const cfg = await getGuildConfig(guildId);
  return cfg.modules.automations !== false; // default on
}

async function runAction(
  automation: Automation,
  ctx: TemplateContext,
): Promise<void> {
  const a = automation.action;
  const text = render(a.message, ctx).slice(0, 1900);
  try {
    if (a.type === "dm_user") {
      const user = userOf(ctx.user);
      if (!user) return;
      await user.send(text).catch(() => {});
    } else if (a.type === "dm_moderator") {
      const mod = userOf(ctx.moderator);
      if (!mod) return;
      await mod.send(text).catch(() => {});
    } else if (a.type === "channel_message") {
      const ch = await ctx.guild.channels.fetch(a.channelId).catch(() => null);
      if (!ch || ch.type !== ChannelType.GuildText) return;
      await (ch as GuildTextBasedChannel).send({ content: text, allowedMentions: { parse: ["users", "roles"] } }).catch(() => {});
    }
  } catch (err) {
    logger.warn({ err, automationId: automation.id, guildId: ctx.guild.id }, "Automation action failed");
  }
}

// ── Public dispatchers ──────────────────────────────────────────────────────

export async function dispatchRoleChange(
  member: GuildMember,
  added: string[],
  removed: string[],
): Promise<void> {
  if (!(await isEnabled(member.guild.id))) return;
  if (added.length === 0 && removed.length === 0) return;

  const automations = await findMatchingAutomations(member.guild.id, (t) =>
    (t.type === "role_added" && added.includes(t.roleId)) ||
    (t.type === "role_removed" && removed.includes(t.roleId)),
  );
  if (automations.length === 0) return;

  for (const automation of automations) {
    const roleId =
      automation.trigger.type === "role_added" || automation.trigger.type === "role_removed"
        ? automation.trigger.roleId
        : null;
    const role = roleId ? member.guild.roles.cache.get(roleId) ?? null : null;
    await runAction(automation, {
      guild: member.guild,
      user: member,
      role: role ? { id: role.id, name: role.name } : null,
    });
  }
}

export async function dispatchMemberJoin(member: GuildMember): Promise<void> {
  if (!(await isEnabled(member.guild.id))) return;
  const automations = await findMatchingAutomations(member.guild.id, (t) => t.type === "member_joined");
  for (const a of automations) await runAction(a, { guild: member.guild, user: member });
}

export async function dispatchMemberLeave(
  guild: Guild,
  user: User,
): Promise<void> {
  if (!(await isEnabled(guild.id))) return;
  const automations = await findMatchingAutomations(guild.id, (t) => t.type === "member_left");
  for (const a of automations) await runAction(a, { guild, user });
}

export interface ModActionEvent {
  guild: Guild;
  action: ModActionKind; // not "any" — concrete action
  moderator: User | GuildMember;
  target: User | GuildMember;
  reason?: string | null;
}

export async function dispatchModAction(ev: ModActionEvent): Promise<void> {
  if (!(await isEnabled(ev.guild.id))) return;
  const automations = await findMatchingAutomations(ev.guild.id, (t) =>
    t.type === "mod_action" && (t.action === "any" || t.action === ev.action),
  );
  if (automations.length === 0) return;

  for (const automation of automations) {
    await runAction(automation, {
      guild: ev.guild,
      user: ev.target,
      moderator: ev.moderator,
      reason: ev.reason ?? null,
      action: ev.action,
    });
  }
}

// Safe wrappers so callers in command handlers never throw
export function safeDispatchModAction(ev: ModActionEvent): void {
  dispatchModAction(ev).catch((err) =>
    logger.warn({ err, guildId: ev.guild.id, action: ev.action }, "dispatchModAction failed"),
  );
}

export function safeDispatchRoleChange(
  member: GuildMember,
  added: string[],
  removed: string[],
): void {
  dispatchRoleChange(member, added, removed).catch((err) =>
    logger.warn({ err, guildId: member.guild.id }, "dispatchRoleChange failed"),
  );
}

export function safeDispatchMemberJoin(member: GuildMember): void {
  dispatchMemberJoin(member).catch((err) =>
    logger.warn({ err, guildId: member.guild.id }, "dispatchMemberJoin failed"),
  );
}

export function safeDispatchMemberLeave(guild: Guild, user: User): void {
  dispatchMemberLeave(guild, user).catch((err) =>
    logger.warn({ err, guildId: guild.id }, "dispatchMemberLeave failed"),
  );
}

// Re-export client type only to keep the module self-contained for callers
export type { Client };
