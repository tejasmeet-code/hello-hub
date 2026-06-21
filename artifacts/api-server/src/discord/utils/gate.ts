import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { isWhitelisted, type WhitelistedCommand } from "../storage/whitelist";

/**
 * Checks if the invoking user is allowed to run a restricted command.
 * Server owners and administrators are always allowed in their own server.
 * Replies with an ephemeral denial message and returns false if not allowed.
 */
export async function ensureWhitelisted(
  interaction: ChatInputCommandInteraction,
  command: WhitelistedCommand,
): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return false;
  }

  const isOwner = interaction.guild?.ownerId === interaction.user.id;
  const isAdmin =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
    false;

  if (isOwner || isAdmin) {
    return true;
  }

  const allowed = await isWhitelisted(
    command,
    interaction.guildId,
    interaction.user.id,
  );
  if (!allowed) {
    await interaction.reply({
      content: `You aren't on the whitelist for \`/${command}\`. Ask an admin to add you with \`/whitelist-${command} add\`.`,
      ephemeral: true,
    });
    return false;
  }
  return true;
}
