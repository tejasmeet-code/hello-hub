import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { COLORS, CE } from "../utils/embedStyle";
import { getCommands } from "../registry";
import { getGuildConfig } from "../storage/config";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("bot-check")
    .setDescription("Global-whitelist only: Run diagnostic checks on this bot or another bot.")
    .setDMPermission(false)
    .addUserOption((o) =>
      o
        .setName("target")
        .setDescription("Mention another bot to check its permissions and status.")
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "This command is restricted to global-whitelist developers.",
        flags: 1 << 6,
      });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    const targetUser = interaction.options.getUser("target");

    // If a target is provided, check that specific bot
    if (targetUser) {
      if (!targetUser.bot) {
        await interaction.editReply({ content: `${CE.error.str} The target must be a bot.` });
        return;
      }

      const member = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
      if (!member) {
        await interaction.editReply({ content: `${CE.error.str} That bot is not in this server.` });
        return;
      }

      const perms = member.permissions;
      const isAdmin = perms.has(PermissionFlagsBits.Administrator);
      
      const status = member.presence?.status || "offline";
      let statusEmoji = "⚫";
      if (status === "online") statusEmoji = "🟢";
      if (status === "idle") statusEmoji = "🟡";
      if (status === "dnd") statusEmoji = "🔴";

      const joinedAt = member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : "Unknown";

      const embed = new EmbedBuilder()
        .setTitle(`${CE.admin.str} Diagnostics: ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setColor(isAdmin ? COLORS.success : COLORS.warning)
        .addFields(
          { name: "Presence", value: `${statusEmoji} ${status.toUpperCase()}`, inline: true },
          { name: "Joined Server", value: joinedAt, inline: true },
          { name: "Administrator", value: isAdmin ? `${CE.success.str} Yes` : `${CE.error.str} No`, inline: true },
          { 
            name: "Important Permissions", 
            value: 
              `Manage Roles: ${perms.has(PermissionFlagsBits.ManageRoles) ? CE.success.str : CE.error.str}\n` +
              `Manage Channels: ${perms.has(PermissionFlagsBits.ManageChannels) ? CE.success.str : CE.error.str}\n` +
              `Kick Members: ${perms.has(PermissionFlagsBits.KickMembers) ? CE.success.str : CE.error.str}\n` +
              `Ban Members: ${perms.has(PermissionFlagsBits.BanMembers) ? CE.success.str : CE.error.str}\n` +
              `Manage Messages: ${perms.has(PermissionFlagsBits.ManageMessages) ? CE.success.str : CE.error.str}`
          }
        )
        .setFooter({ text: "Note: We cannot check internal latency or databases of other bots." })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Otherwise, check OUR bot
    const client = interaction.client;
    
    // 1. Latency check
    const wsPing = client.ws.ping;
    let wsEmoji: string = CE.success.str;
    if (wsPing > 500) wsEmoji = CE.error.str;
    else if (wsPing > 200) wsEmoji = CE.warning.str;

    // 2. Database check
    let dbStatus = `${CE.success.str} Connected & Responsive`;
    let dbTime = 0;
    try {
      const dbStart = Date.now();
      await getGuildConfig(interaction.guildId!);
      dbTime = Date.now() - dbStart;
    } catch (e) {
      dbStatus = `${CE.error.str} Error connecting to Database: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 3. Permissions check
    const me = interaction.guild?.members.me;
    const hasAdmin = me?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
    const permStatus = hasAdmin ? `${CE.success.str} Administrator (All clear)` : `${CE.error.str} Missing Administrator`;

    // 4. Command registry
    const allCmds = getCommands();
    
    // 5. Uptime
    const uptime = client.uptime ? `<t:${Math.floor((Date.now() - client.uptime) / 1000)}:R>` : "Unknown";

    const embed = new EmbedBuilder()
      .setTitle(`${CE.admin.str} System Diagnostics: ${client.user?.tag}`)
      .setColor(hasAdmin && !dbStatus.includes("Error") ? COLORS.success : COLORS.danger)
      .addFields(
        { name: "WebSocket Ping", value: `${wsEmoji} \`${wsPing}ms\``, inline: true },
        { name: "Database Latency", value: dbStatus.includes("Error") ? dbStatus : `${CE.success.str} \`${dbTime}ms\``, inline: true },
        { name: "Uptime", value: uptime, inline: true },
        { name: "Permissions", value: permStatus, inline: false },
        { name: "Total Registered Commands", value: `\`${allCmds.length}\``, inline: false }
      )
      .setFooter({ text: "Diagnostics check completed." })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
