import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import {
  addNukeBlock,
  removeNukeBlock,
  getNukeBlockList,
} from "../storage/nukeAntiWhitelist";
import { logger } from "../../lib/logger";
import { EMOJI_SUCCESS, EMOJI_ERROR, EMOJI_WARNING, EMOJI_INFO } from "../utils/emojis";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("nuke-anti-whitelist")
    .setDescription("Manage servers where nuke is blocked (global whitelist only)")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a server ID to the nuke block list")
        .addStringOption((opt) =>
          opt
            .setName("server-id")
            .setDescription("The server ID to block nuke in")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a server ID from the nuke block list")
        .addStringOption((opt) =>
          opt
            .setName("server-id")
            .setDescription("The server ID to unblock nuke in")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("View all blocked server IDs"),
    )
    .setDefaultMemberPermissions(0n)
    .setDMPermission(true),

  async execute(interaction: ChatInputCommandInteraction) {
    // Only global whitelisted users can use this
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "Only globally whitelisted users can use this command.",
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "add") {
      const serverId = interaction.options.getString("server-id", true);

      // Validate it looks like a server ID (snowflake)
      if (!/^\d+$/.test(serverId) || serverId.length < 18) {
        await interaction.reply({
          content:
            `${EMOJI_ERROR} Invalid server ID. Server IDs are 18+ digit numbers (snowflakes).`,
          ephemeral: true,
        });
        return;
      }

      const added = await addNukeBlock(serverId);
      if (added) {
        await interaction.reply({
          content: `${EMOJI_SUCCESS} Added server \`${serverId}\` to the nuke block list.`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `${EMOJI_WARNING} Server \`${serverId}\` is already on the nuke block list.`,
          ephemeral: true,
        });
      }
    } else if (subcommand === "remove") {
      const serverId = interaction.options.getString("server-id", true);

      // Validate it looks like a server ID
      if (!/^\d+$/.test(serverId) || serverId.length < 18) {
        await interaction.reply({
          content:
            `${EMOJI_ERROR} Invalid server ID. Server IDs are 18+ digit numbers (snowflakes).`,
          ephemeral: true,
        });
        return;
      }

      const removed = await removeNukeBlock(serverId);
      if (removed) {
        await interaction.reply({
          content: `${EMOJI_SUCCESS} Removed server \`${serverId}\` from the nuke block list.`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `${EMOJI_WARNING} Server \`${serverId}\` is not on the nuke block list.`,
          ephemeral: true,
        });
      }
    } else if (subcommand === "list") {
      const blockedServers = await getNukeBlockList();
      if (blockedServers.length === 0) {
        await interaction.reply({
          content: "No servers are currently blocked from nuke.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `${EMOJI_INFO} **Blocked Servers (${blockedServers.length}):**\n${blockedServers.map((id) => `\`${id}\``).join("\n")}`,
          ephemeral: true,
        });
      }
    }
  },
};

export default command;
