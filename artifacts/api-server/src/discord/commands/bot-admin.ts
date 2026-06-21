import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { BASE_PERM_WHITELIST } from "../storage/whitelist";
import { getJailRoleId, ensureJailRole, releaseJailFromMember } from "../storage/jail";
import { recordModStat } from "../storage/modstats";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embedStyle";

/**
 * /bot-admin — Developer-only command to perform moderation actions in any
 * guild the bot is in. Restricted to BASE_PERM_WHITELIST user IDs only.
 */
const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("bot-admin")
    .setDescription("[Bot Dev only] Perform a moderation action in any guild by ID.")
    .addSubcommand((sub) =>
      sub
        .setName("unjail")
        .setDescription("Unjail a user in a specific server.")
        .addStringOption((o) => o.setName("guild_id").setDescription("The server ID").setRequired(true))
        .addStringOption((o) => o.setName("user_id").setDescription("The user ID to unjail").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(512)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("unban")
        .setDescription("Unban a user in a specific server.")
        .addStringOption((o) => o.setName("guild_id").setDescription("The server ID").setRequired(true))
        .addStringOption((o) => o.setName("user_id").setDescription("The user ID to unban").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(512)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("unmute")
        .setDescription("Remove timeout (unmute) a user in a specific server.")
        .addStringOption((o) => o.setName("guild_id").setDescription("The server ID").setRequired(true))
        .addStringOption((o) => o.setName("user_id").setDescription("The user ID to unmute").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(512)),
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    // Strictly restricted to bot developers
    if (!BASE_PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({ embeds: [errorEmbed("Access denied", "This command is restricted to bot developers.")] , flags: 1 << 6 });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.options.getString("guild_id", true).trim();
    const userId = interaction.options.getString("user_id", true).trim();
    const reason = interaction.options.getString("reason") ?? "Bot admin action";

    if (!/^\d{15,25}$/.test(guildId)) {
      await interaction.reply({ embeds: [errorEmbed("Invalid guild ID", "That doesn't look like a valid server ID.")] , flags: 1 << 6 });
      return;
    }
    if (!/^\d{15,25}$/.test(userId)) {
      await interaction.reply({ embeds: [errorEmbed("Invalid user ID", "That doesn't look like a valid user ID.")] , flags: 1 << 6 });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    const guild = interaction.client.guilds.cache.get(guildId)
      ?? await interaction.client.guilds.fetch(guildId).catch(() => null);

    if (!guild) {
      await interaction.editReply({ embeds: [errorEmbed("Server not found", `The bot isn't in server \`${guildId}\` or the ID is wrong.`)] });
      return;
    }

    // ─── UNJAIL ────────────────────────────────────────────────────────────────
    if (sub === "unjail") {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await interaction.editReply({ embeds: [errorEmbed("Member not found", `<@${userId}> isn't in **${guild.name}**.`)] });
        return;
      }

      const roleId = (await getJailRoleId(guildId)) ?? (await ensureJailRole(guild));
      if (!roleId) {
        await interaction.editReply({ embeds: [errorEmbed("No jail role", `No Jailed role found in **${guild.name}**.`)] });
        return;
      }

      if (!member.roles.cache.has(roleId)) {
        await interaction.editReply({ embeds: [infoEmbed("Not jailed", `<@${userId}> isn't jailed in **${guild.name}**.`)] });
        return;
      }

      const me = guild.members.me;
      if (!me) {
        await interaction.editReply({ embeds: [errorEmbed("Bot error", "Couldn't read my own member info.")] });
        return;
      }
      if (!member.manageable) {
        await interaction.editReply({ embeds: [errorEmbed("No permission", "I can't modify that user's roles (role hierarchy).")] });
        return;
      }

      try {
        const result = await releaseJailFromMember(member, roleId, me, reason);
        await recordModStat({ guildId, modId: interaction.user.id, targetId: userId, action: "unjail", delta: -1, reason });

        const notes: string[] = [];
        if (result.restored > 0) notes.push(`restored **${result.restored}** role${result.restored === 1 ? "" : "s"}`);
        if (result.missing > 0) notes.push(`**${result.missing}** role${result.missing === 1 ? "" : "s"} no longer exist`);
        if (result.aboveBot > 0) notes.push(`**${result.aboveBot}** role${result.aboveBot === 1 ? "" : "s"} above bot were skipped`);
        const tail = notes.length ? ` (${notes.join(", ")})` : "";

        await interaction.editReply({
          embeds: [successEmbed("Unjailed", `<@${userId}> has been released from jail in **${guild.name}**.${tail}\n**Reason:** ${reason}`)],
        });
      } catch {
        await interaction.editReply({ embeds: [errorEmbed("Failed", "Could not remove the Jailed role.")] });
      }
      return;
    }

    // ─── UNBAN ─────────────────────────────────────────────────────────────────
    if (sub === "unban") {
      const ban = await guild.bans.fetch(userId).catch(() => null);
      if (!ban) {
        await interaction.editReply({ embeds: [infoEmbed("Not banned", `<@${userId}> isn't banned in **${guild.name}**.`)] });
        return;
      }

      try {
        await guild.bans.remove(userId, `${reason} — by ${interaction.user.tag}`);
        await recordModStat({ guildId, modId: interaction.user.id, targetId: userId, action: "unban", delta: -1, reason });
        await interaction.editReply({
          embeds: [successEmbed("Unbanned", `**${ban.user.tag}** has been unbanned from **${guild.name}**.\n**Reason:** ${reason}`)],
        });
      } catch {
        await interaction.editReply({ embeds: [errorEmbed("Failed", "Could not unban that user.")] });
      }
      return;
    }

    // ─── UNMUTE ────────────────────────────────────────────────────────────────
    if (sub === "unmute") {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await interaction.editReply({ embeds: [errorEmbed("Member not found", `<@${userId}> isn't in **${guild.name}**.`)] });
        return;
      }

      if (!member.isCommunicationDisabled()) {
        await interaction.editReply({ embeds: [infoEmbed("Not muted", `<@${userId}> isn't currently muted in **${guild.name}**.`)] });
        return;
      }

      if (!member.moderatable) {
        await interaction.editReply({ embeds: [errorEmbed("No permission", "I can't modify that user (role hierarchy).")] });
        return;
      }

      try {
        await member.timeout(null, `${reason} — by ${interaction.user.tag}`);
        await recordModStat({ guildId, modId: interaction.user.id, targetId: userId, action: "unmute", delta: -1, reason });
        await interaction.editReply({
          embeds: [successEmbed("Unmuted", `<@${userId}> has been unmuted in **${guild.name}**.\n**Reason:** ${reason}`)],
        });
      } catch {
        await interaction.editReply({ embeds: [errorEmbed("Failed", "Could not remove the timeout.")] });
      }
      return;
    }
  },
};

export default command;