import type { Message } from "discord.js";
import { getAFK, removeAFK } from "../storage/afk";
import { getGuildConfig } from "../storage/config";
import { hasPremiumAccess } from "../storage/premium";
import { getCommandMap } from "../registry";
import { CE } from "./embedStyle";
import { logger } from "../../lib/logger";

export async function handleAFKMessage(message: Message): Promise<void> {
  if (message.author.bot) return;

  // 1. If author was AFK, clear their AFK status
  const authorAfk = await getAFK(message.author.id);
  if (authorAfk) {
    if (authorAfk.scope === "global" || authorAfk.guildId === message.guildId) {
      await removeAFK(message.author.id);
      await message.reply({
        content: `${CE.success.str} Welcome back ${message.author}! I removed your AFK status (**Reason:** ${authorAfk.reason}).`,
      }).catch(() => {});
    }
  }

  // 2. Intercept pings to AFK users
  if (message.mentions.users.size > 0) {
    for (const [userId, user] of message.mentions.users.entries()) {
      if (userId === message.author.id) continue;
      const targetAfk = await getAFK(userId);
      if (!targetAfk) continue;

      if (targetAfk.scope === "server" && targetAfk.guildId && targetAfk.guildId !== message.guildId) {
        continue;
      }

      const relTime = `<t:${Math.floor(targetAfk.timestamp / 1000)}:R>`;
      await message.reply({
        content: `${CE.notifications.str} **${user.username}** is currently AFK (${relTime}): ${targetAfk.reason}`,
      }).catch(() => {});
    }
  }
}

export async function handleAutoReactMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.guildId) return;

  try {
    const cfg = await getGuildConfig(message.guildId);
    const mappings = cfg.autoReactMappings;
    if (!mappings || mappings.length === 0) return;

    const authorId = message.author.id;
    const channelId = message.channelId;
    const parentId = "parentId" in message.channel ? (message.channel.parentId ?? null) : null;

    for (const m of mappings) {
      let matches = false;
      if (m.targetType === "user" && m.targetId === authorId) matches = true;
      else if (m.targetType === "channel" && m.targetId === channelId) matches = true;
      else if (m.targetType === "category" && parentId && m.targetId === parentId) matches = true;

      if (matches && m.emoji) {
        await message.react(m.emoji).catch(() => {});
      }
    }
  } catch (err) {
    logger.error({ err }, "Error in auto-react message interceptor");
  }
}

export async function handleNoPrefixNLPMessage(message: Message): Promise<boolean> {
  if (message.author.bot || !message.inGuild()) return false;

  const content = message.content.trim();
  if (!content) return false;

  // Ignore if already starting with prefix or slash
  if (content.startsWith(".") || content.startsWith("/") || content.startsWith("!")) return false;

  // Check if user or guild has Premium Access
  const isPremium = await hasPremiumAccess(message.author.id, message.guildId);
  if (!isPremium) return false;

  const tokens = content.split(/\s+/);
  const firstWord = (tokens[0] || "").toLowerCase();

  // Safe fuzzy or direct matching against registered slash command names
  const commandMap = getCommandMap();
  let matchedCommand = commandMap.get(firstWord);

  if (!matchedCommand) {
    // Check if firstWord is close partial match (e.g., minimum 3 letters and command starts with firstWord)
    if (firstWord.length >= 3) {
      for (const [name, cmd] of commandMap.entries()) {
        if (name === firstWord || (name.startsWith(firstWord) && Math.abs(name.length - firstWord.length) <= 2)) {
          matchedCommand = cmd;
          break;
        }
      }
    }
  }

  if (!matchedCommand) return false;

  // Check setup wizard restriction
  const cfg = await getGuildConfig(message.guildId);
  if (!cfg.setupWizardCompleted && matchedCommand.data.name !== "setup" && matchedCommand.data.name !== "help") {
    await message.reply({
      content: "⚠️ Normal command usage is restricted until a server administrator runs the `/setup` onboarding wizard.",
    }).catch(() => {});
    return true;
  }

  // Execute command seamlessly via simulated interaction/prefix bridge
  const args = tokens.slice(1);
  try {
    const fakeInteraction = createFakeInteractionFromMessage(message, matchedCommand.data.name, args);
    await matchedCommand.execute(fakeInteraction as any);
    return true;
  } catch (err) {
    logger.error({ err, commandName: matchedCommand.data.name }, "Error executing NLP No-Prefix command");
    return false;
  }
}

function createFakeInteractionFromMessage(message: Message, commandName: string, args: string[]) {
  const channel = message.channel;
  return {
    isChatInputCommand: () => true,
    commandName,
    guildId: message.guildId,
    guild: message.guild,
    channelId: message.channelId,
    channel,
    user: message.author,
    member: message.member,
    client: message.client,
    createdAt: message.createdAt,
    deferred: false,
    replied: false,
    options: {
      getString: (name: string, required?: boolean) => args[0] ?? (required ? "" : null),
      getUser: (name: string) => message.mentions.users.first() ?? null,
      getMember: (name: string) => message.mentions.members?.first() ?? null,
      getChannel: (name: string) => message.mentions.channels.first() ?? null,
      getRole: (name: string) => message.mentions.roles.first() ?? null,
      getInteger: (name: string) => (args[0] ? parseInt(args[0], 10) : null),
      getBoolean: (name: string) => (args[0] ? args[0].toLowerCase() === "true" : null),
      getSubcommand: () => args[0] ?? null,
    },
    reply: async (payload: any) => message.reply(payload),
    editReply: async (payload: any) => message.reply(payload),
    followUp: async (payload: any) => message.reply(payload),
    deferReply: async () => {},
  };
}
