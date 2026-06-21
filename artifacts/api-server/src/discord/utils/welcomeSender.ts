import { EmbedBuilder, type User, type Guild, type GuildMember } from "discord.js";
import type { WelcomerEmbedConfig } from "../storage/welcomer";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function applyWelcomerPlaceholders(
  text: string,
  user: User,
  guild: Guild,
  count: number,
): string {
  return text
    .replace(/\{user\}/g, `<@${user.id}>`)
    .replace(/\{username\}/g, user.username)
    .replace(/\{tag\}/g, user.tag ?? user.username)
    .replace(/\{server\}/g, guild.name)
    .replace(/\{count\}/g, String(count))
    .replace(/\{ordinal\}/g, ordinal(count));
}

export function buildWelcomerEmbed(
  embedCfg: WelcomerEmbedConfig,
  user: User,
  guild: Guild,
  count: number,
): EmbedBuilder {
  const eb = new EmbedBuilder().setColor(embedCfg.color ?? 0x5865f2);
  const title = embedCfg.title
    ? applyWelcomerPlaceholders(embedCfg.title, user, guild, count)
    : `Welcome to ${guild.name}!`;
  const description = embedCfg.description
    ? applyWelcomerPlaceholders(embedCfg.description, user, guild, count)
    : `Hey <@${user.id}>, welcome! You are our **${ordinal(count)}** member 🎉`;
  eb.setTitle(title).setDescription(description);
  if (embedCfg.footer) {
    eb.setFooter({ text: applyWelcomerPlaceholders(embedCfg.footer, user, guild, count) });
  }
  if (embedCfg.imageUrl) eb.setImage(embedCfg.imageUrl);
  if (embedCfg.thumbnailUrl) eb.setThumbnail(embedCfg.thumbnailUrl);
  return eb;
}

export function buildWelcomerText(
  message: string | undefined,
  user: User,
  guild: Guild,
  count: number,
): string {
  return applyWelcomerPlaceholders(
    message ?? `Welcome {user} to **{server}**! You are our **{ordinal}** member 🎉`,
    user,
    guild,
    count,
  );
}
