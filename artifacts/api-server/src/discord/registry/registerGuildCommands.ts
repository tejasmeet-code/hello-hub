import { REST, Routes } from "discord.js";
import type { Client } from "discord.js";
import { getGuildCommands } from "../registry";

/**
 * Registers slash commands for a specific guild — takes effect instantly
 * (no ~1 hour propagation delay like global commands).
 * Called when the bot joins a new server and on startup for all cached guilds.
 */
export async function registerGuildCommands(_client: Client, guildId: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) return;

  const commands = getGuildCommands();
  const rest = new REST({ version: "10" }).setToken(token);

  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands.map((c) => c.data.toJSON()),
    });
  } catch {
    // Don't throw — a command registration failure should never prevent
    // the bot from processing guild events normally.
  }
}
