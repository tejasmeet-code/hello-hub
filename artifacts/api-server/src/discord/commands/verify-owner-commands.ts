import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { getGuildConfig, updateGuildConfig } from "../storage/config";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("verify-owner-commands")
    .setDescription(
      "Owner-only: enable all commands for every server member without setting up a verified role.",
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: 1 << 6,
      });
      return;
    }

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isGlobalWhitelisted = PERM_WHITELIST.has(interaction.user.id);
    if (!isOwner && !isGlobalWhitelisted) {
      await interaction.reply({
        content:
          "Only the server owner or globally authorized users can run this command.",
        flags: 1 << 6,
      });
      return;
    }

    const cfg = await getGuildConfig(interaction.guildId);

    if (cfg.commandsUnlocked) {
      await interaction.reply({
        content: `${CE.success.str} Commands are already unlocked — all server members can use bot commands.`,
        flags: 1 << 6,
      });
      return;
    }

    await updateGuildConfig(interaction.guildId, (c) => {
      c.commandsUnlocked = true;
      return c;
    });

    await interaction.reply({
      content:
        `${CE.success.str} **All commands unlocked.**\n\n` +
        "Every server member can now use bot commands without needing to be added to a per-command whitelist.\n" +
        "No verification role was created and the verify module was not changed.\n\n" +
        "Server owners and administrators were already unrestricted — this unlocks commands for regular members too.",
      flags: 1 << 6,
    });
  },
};

export default command;