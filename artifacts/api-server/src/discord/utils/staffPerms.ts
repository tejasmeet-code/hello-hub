import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getGuildConfig } from "../storage/config";
import { PERM_WHITELIST } from "../storage/whitelist";

export async function isManager(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (PERM_WHITELIST.has(interaction.user.id)) return true;
  if (!interaction.inGuild() || !interaction.guildId) return false;

  const member = interaction.member;
  const isAdmin =
    !!member &&
    typeof member.permissions !== "string" &&
    member.permissions.has(PermissionFlagsBits.Administrator);
  if (isAdmin) return true;

  const isOwner = interaction.guild?.ownerId === interaction.user.id;
  if (isOwner) return true;

  const cfg = await getGuildConfig(interaction.guildId);
  if (cfg.managers.userIds.includes(interaction.user.id)) return true;

  if (cfg.managers.roleIds.length > 0 && member && typeof member.permissions !== "string") {
    const memberRoles = (interaction.guild &&
      (await interaction.guild.members
        .fetch(interaction.user.id)
        .catch(() => null))) || null;
    if (memberRoles) {
      for (const id of cfg.managers.roleIds) {
        if (memberRoles.roles.cache.has(id)) return true;
      }
    }
  }
  return false;
}

export function isAdminOrOwner(
  interaction: ChatInputCommandInteraction,
): boolean {
  if (!interaction.inGuild()) return false;
  const member = interaction.member;
  const isAdmin =
    !!member &&
    typeof member.permissions !== "string" &&
    member.permissions.has(PermissionFlagsBits.Administrator);
  return (
    isAdmin || interaction.guild?.ownerId === interaction.user.id || false
  );
}
