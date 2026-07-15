import type { Message } from "discord.js";
import { getAFK, removeAFK } from "../storage/afk";
import { getGuildConfig } from "../storage/config";
import { hasPremiumAccess, isBotAdmin } from "../storage/premium";
import { getCommandMap } from "../registry";
import { handleGenericPrefixCommand } from "../messageHandler";
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
      const afk = await getAFK(userId);
      if (afk && (afk.scope === "global" || afk.guildId === message.guildId)) {
        await message.reply({
          content: `ℹ️ **${user.tag}** is currently AFK (${afk.scope === "global" ? "Global" : "Server-Only"}): \`${afk.reason}\` (since <t:${afk.timestamp}:R>)`,
          allowedMentions: { parse: [] },
        }).catch(() => {});
      }
    }
  }
}

export async function handleAutoReactMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.inGuild()) return;

  try {
    const cfg = await getGuildConfig(message.guildId);
    const mappings = cfg.autoReactMappings || [];
    if (mappings.length === 0) return;

    for (const m of mappings) {
      let shouldReact = false;
      if (m.targetType === "channel" && message.channelId === m.targetId) {
        shouldReact = true;
      } else if (m.targetType === "user" && message.author.id === m.targetId) {
        shouldReact = true;
      } else if (m.targetType === "category" && message.channel && (message.channel as any).parentId === m.targetId) {
        shouldReact = true;
      }

      if (shouldReact) {
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

  const cfg = await getGuildConfig(message.guildId);
  if (cfg.modules.noPrefix === false && !isBotAdmin(message.author.id)) return false;

  const isPremium = await hasPremiumAccess(message.author.id, message.guildId);
  const isWhitelistedUser = (cfg.noPrefixUserIds ?? []).includes(message.author.id);
  const exemptRoles = [...(cfg.noPrefixRoles ?? []), ...(cfg.moduleRoles?.noPrefix ?? [])];
  const isWhitelistedRole = message.member && exemptRoles.some((r) => message.member!.roles.cache.has(r));
  const isAdminUser = isBotAdmin(message.author.id);

  if (!isPremium && !isWhitelistedUser && !isWhitelistedRole && !isAdminUser) return false;

  const tokens = content.split(/\s+/);
  const firstWord = (tokens[0] || "").toLowerCase();

  const commandMap = getCommandMap();
  let matchedCommand = commandMap.get(firstWord);

  if (!matchedCommand) {
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

  if (!cfg.setupWizardCompleted && matchedCommand.data.name !== "setup" && matchedCommand.data.name !== "help") {
    await message.reply({
      content: "⚠️ Normal command usage is restricted until a server administrator runs the `/setup` onboarding wizard.",
    }).catch(() => {});
    return true;
  }

  const args = tokens.slice(1);
  try {
    await handleGenericPrefixCommand(message, message.guild!, message.member, matchedCommand, args);
    return true;
  } catch (err) {
    logger.error({ err, commandName: matchedCommand.data.name }, "Error executing NLP No-Prefix command");
    return false;
  }
}
