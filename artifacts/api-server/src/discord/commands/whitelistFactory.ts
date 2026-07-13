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
  listGuildAllWhitelist,
  removeFromWhitelist,
  isWhitelisted,
  PERM_WHITELIST,
  type WhitelistedCommand,
} from "../storage/whitelist";
import { EMOJI_SUCCESS } from "../utils/emojis";

/**
 * Builds a /whitelist-<command> slash command with add/remove/list subcommands.
 * Only server administrators (or perm-whitelisted users) can manage whitelists.
 */
export function buildWhitelistCommand(
  command: WhitelistedCommand,
): SlashCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(`whitelist-${command}`)
      .setDescription(`Manage who can use /${command} in this server.`)
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription(`Allow a user to use /${command}.`)
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
          .setDescription(`Revoke a user's access to /${command}.`)
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
          .setDescription(`Show who is whitelisted for /${command}.`),
      )
      .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
      if (!interaction.inGuild() || !interaction.guildId) {
        await interaction.reply({
          content: "This command can only be used in a server.",
          ephemeral: true,
        });
        return;
      }

      // Allow admins OR perm-whitelisted users to manage the whitelist.
      const member = interaction.member;
      const isAdmin =
        !!member &&
        typeof member.permissions !== "string" &&
        member.permissions.has(PermissionFlagsBits.Administrator);
      const canManage = isAdmin || PERM_WHITELIST.has(interaction.user.id);

      if (!canManage) {
        await interaction.reply({
          content: "Only server administrators can manage the whitelist.",
          ephemeral: true,
        });
        return;
      }

      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;

      if (sub === "add") {
        const target = interaction.options.getUser("user", true);
        const added = await addToWhitelist(command, guildId, target.id);
        if (!added) {
          await interaction.reply({
            content: `**${target.tag}** is already whitelisted for \`/${command}\`.`,
            ephemeral: true,
          });
          return;
        }
        await interaction.reply(
          `${EMOJI_SUCCESS} **${target.tag}** can now use \`/${command}\`.`,
        );
        return;
      }

      if (sub === "remove") {
        const target = interaction.options.getUser("user", true);
        if (PERM_WHITELIST.has(target.id)) {
          await interaction.reply({
            content: `**${target.tag}** is on the global allow list and can't be removed.`,
            ephemeral: true,
          });
          return;
        }
        const removed = await removeFromWhitelist(
          command,
          guildId,
          target.id,
        );
        if (!removed) {
          await interaction.reply({
            content: `**${target.tag}** wasn't on the whitelist for \`/${command}\`.`,
            ephemeral: true,
          });
          return;
        }
        await interaction.reply(
          `🗑️ Removed **${target.tag}** from the \`/${command}\` whitelist.`,
        );
        return;
      }

      if (sub === "list") {
        const ids = await listWhitelist(command, guildId);
        const allIds = await listGuildAllWhitelist(guildId);
        const permLines = [...PERM_WHITELIST].map(
          (id) => `• <@${id}> *(global)*`,
        );
        const allLines = allIds.map((id) => `• <@${id}> *(all-commands)*`);
        const guildLines = ids
          .filter((id) => !allIds.includes(id))
          .map((id) => `• <@${id}>`);
        const description =
          [...permLines, ...allLines, ...guildLines].join("\n") ||
          "*Nobody yet.*";
        const embed = new EmbedBuilder()
          .setTitle(`Whitelist — /${command}`)
          .setColor(0x2b2d31)
          .setDescription(description)
          .setFooter({
            text: `${ids.length} command-specific • ${allIds.length} all-commands • ${PERM_WHITELIST.size} global`,
          });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
    },
  };
}

export { isWhitelisted };
