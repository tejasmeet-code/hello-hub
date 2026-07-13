import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  addToWhitelist,
  listWhitelist,
  removeFromWhitelist,
  listGuildAllWhitelist,
  PERM_WHITELIST,
  WHITELISTED_COMMANDS,
  type WhitelistedCommand,
} from "../storage/whitelist";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Manage command-specific whitelists for this server.")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Allow a user to use a restricted command.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("The command to whitelist")
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The user to whitelist")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Revoke a user's access to a restricted command.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("The command to remove whitelist access for")
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The user to remove")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List whitelisted users for a restricted command.")
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("The command to inspect")
            .setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: 1 << 6,
      });
      return;
    }

    const member = interaction.member;
    const isAdmin =
      !!member &&
      typeof member.permissions !== "string" &&
      member.permissions.has(PermissionFlagsBits.Administrator);
    const canManage = isAdmin || PERM_WHITELIST.has(interaction.user.id);

    if (!canManage) {
      await interaction.reply({
        content: "Only server administrators can manage the whitelist.",
        flags: 1 << 6,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const commandName = interaction.options.getString("command", true);
    const guildId = interaction.guildId;

    if (!WHITELISTED_COMMANDS.includes(commandName as any)) {
      await interaction.reply({
        content:
          "The command must be one of the restricted bot commands, e.g. /ban, /mute, /warn.",
        flags: 1 << 6,
      });
      return;
    }

    const command = commandName as WhitelistedCommand;

    if (sub === "add") {
      const target = interaction.options.getUser("user", true);
      const added = await addToWhitelist(command, guildId, target.id);
      if (!added) {
        await interaction.reply({
          content: `**${target.tag}** is already whitelisted for \`/${commandName}\`.`,
          flags: 1 << 6,
        });
        return;
      }

      await interaction.reply(`${CE.success.str} **${target.tag}** can now use \`/${commandName}\`.`);
      return;
    }

    if (sub === "remove") {
      const target = interaction.options.getUser("user", true);
      if (PERM_WHITELIST.has(target.id)) {
        await interaction.reply({
          content: `**${target.tag}** is on the global allow list and can't be removed.`,
          flags: 1 << 6,
        });
        return;
      }

      const removed = await removeFromWhitelist(command, guildId, target.id);
      if (!removed) {
        await interaction.reply({
          content: `**${target.tag}** wasn't on the whitelist for \`/${commandName}\`.`,
          flags: 1 << 6,
        });
        return;
      }

      await interaction.reply(`${CE.error.str} Removed **${target.tag}** from the \`/${commandName}\` whitelist.`);
      return;
    }

    if (sub === "list") {
      const ids = await listWhitelist(command, guildId);
      const allIds = await listGuildAllWhitelist(guildId);
      const permLines = Array.from(PERM_WHITELIST).map((id) => `• <@${id}> *(global)*`);
      const allLines = allIds.map((id) => `• <@${id}> *(all-commands)*`);
      const guildLines = ids.filter((id) => !allIds.includes(id)).map((id) => `• <@${id}>`);
      const description = [...permLines, ...allLines, ...guildLines].join("\n") || "*Nobody yet.*";
      const embed = new EmbedBuilder()
        .setTitle(`Whitelist — /${commandName}`)
        .setColor(0x2b2d31)
        .setDescription(description)
        .setFooter({
          text: `${ids.length} command-specific • ${allIds.length} all-commands • ${PERM_WHITELIST.size} global`,
        });

      await interaction.reply({ embeds: [embed], flags: 1 << 6 });
      return;
    }
  },
};

export default command;