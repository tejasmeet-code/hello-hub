import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import {
  addToGlobalBlacklist,
  removeFromGlobalBlacklist,
  addToServerBlacklist,
  removeFromServerBlacklist,
  addCommandBlacklist,
  removeCommandBlacklist,
  listBlacklists,
  isGloballyBlacklisted,
  isServerBlacklisted,
} from "../storage/blacklist";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Manage bot blacklists (global whitelist only).")
    .addSubcommand((sub) =>
      sub
        .setName("user")
        .setDescription("Blacklist a user from using any bot command.")
        .addStringOption((option) =>
          option
            .setName("user-id")
            .setDescription("The Discord user ID to blacklist")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Add or remove from blacklist")
            .setRequired(true)
            .addChoices(
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("server")
        .setDescription("Blacklist a server (bot leaves immediately when added).")
        .addStringOption((option) =>
          option
            .setName("server-id")
            .setDescription("The Discord server ID to blacklist")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Add or remove from blacklist")
            .setRequired(true)
            .addChoices(
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("user-command")
        .setDescription("Blacklist a user from using a specific command.")
        .addStringOption((option) =>
          option
            .setName("user-id")
            .setDescription("The Discord user ID")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("command")
            .setDescription("The command name to blacklist")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Add or remove from blacklist")
            .setRequired(true)
            .addChoices(
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Show all blacklists."),
    )
    .setDMPermission(true),

  globalOnly: true,

  async execute(interaction: ChatInputCommandInteraction) {
    // Only existing global-whitelist members can manage blacklists
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "Only globally whitelisted users can manage blacklists.",
        flags: 1 << 6,
      });
      return;
    }

    // Defer now — all remaining paths make at least one async DB call
    await interaction.deferReply();

    const sub = interaction.options.getSubcommand();

    if (sub === "user") {
      const userId = interaction.options.getString("user-id", true).trim();
      const action = interaction.options.getString("action", true);

      if (!/^\d{15,25}$/.test(userId)) {
        await interaction.editReply("That doesn't look like a valid Discord user ID (expected 15–25 digits).");
        return;
      }

      if (action === "add") {
        const added = await addToGlobalBlacklist(userId);
        if (!added) {
          await interaction.editReply(`<@${userId}> (\`${userId}\`) is already globally blacklisted.`);
          return;
        }
        await interaction.editReply(`${CE.success.str} Added <@${userId}> (\`${userId}\`) to the global blacklist. They can no longer use any bot commands.`);
      } else {
        const removed = await removeFromGlobalBlacklist(userId);
        if (!removed) {
          await interaction.editReply(`<@${userId}> (\`${userId}\`) is not globally blacklisted.`);
          return;
        }
        await interaction.editReply(`${CE.success.str} Removed <@${userId}> (\`${userId}\`) from the global blacklist.`);
      }
      return;
    }

    if (sub === "server") {
      const serverId = interaction.options.getString("server-id", true).trim();
      const action = interaction.options.getString("action", true);

      if (!/^\d{15,25}$/.test(serverId)) {
        await interaction.editReply("That doesn't look like a valid Discord server ID (expected 15–25 digits).");
        return;
      }

      if (action === "add") {
        const added = await addToServerBlacklist(serverId);
        if (!added) {
          await interaction.editReply(`Server \`${serverId}\` is already blacklisted.`);
          return;
        }
        await interaction.editReply(`${CE.success.str} Added server \`${serverId}\` to the blacklist. The bot will leave immediately if added to this server.`);
      } else {
        const removed = await removeFromServerBlacklist(serverId);
        if (!removed) {
          await interaction.editReply(`Server \`${serverId}\` is not blacklisted.`);
          return;
        }
        await interaction.editReply(`${CE.success.str} Removed server \`${serverId}\` from the blacklist.`);
      }
      return;
    }

    if (sub === "user-command") {
      const userId = interaction.options.getString("user-id", true).trim();
      const commandName = interaction.options.getString("command", true).trim();
      const action = interaction.options.getString("action", true);

      if (!/^\d{15,25}$/.test(userId)) {
        await interaction.editReply("That doesn't look like a valid Discord user ID (expected 15–25 digits).");
        return;
      }

      if (action === "add") {
        const added = await addCommandBlacklist(userId, commandName);
        if (!added) {
          await interaction.editReply(`<@${userId}> (\`${userId}\`) is already blacklisted from using \`/${commandName}\`.`);
          return;
        }
        await interaction.editReply(`${CE.success.str} Added <@${userId}> (\`${userId}\`) to the blacklist for command \`/${commandName}\`.`);
      } else {
        const removed = await removeCommandBlacklist(userId, commandName);
        if (!removed) {
          await interaction.editReply(`<@${userId}> (\`${userId}\`) is not blacklisted from using \`/${commandName}\`.`);
          return;
        }
        await interaction.editReply(`${CE.success.str} Removed <@${userId}> (\`${userId}\`) from the blacklist for command \`/${commandName}\`.`);
      }
      return;
    }

    if (sub === "list") {
      const blacklists = await listBlacklists();

      const embed = new EmbedBuilder()
        .setTitle("Bot Blacklists")
        .setColor(0xff0000)
        .setTimestamp();

      if (blacklists.globalUsers.length > 0) {
        embed.addFields({
          name: "Globally Blacklisted Users",
          value: blacklists.globalUsers.map(id => `<@${id}> (\`${id}\`)`).join("\n") || "None",
          inline: false,
        });
      }

      if (blacklists.servers.length > 0) {
        embed.addFields({
          name: "Blacklisted Servers",
          value: blacklists.servers.map(id => `\`${id}\``).join("\n") || "None",
          inline: false,
        });
      }

      if (Object.keys(blacklists.perUserCommand).length > 0) {
        const commandBlacklists = Object.entries(blacklists.perUserCommand)
          .map(([userId, commands]) => {
            const commandList = Object.keys(commands).join(", ");
            return `<@${userId}> (\`${userId}\`): ${commandList}`;
          })
          .join("\n");

        embed.addFields({
          name: "Command-Specific Blacklists",
          value: commandBlacklists || "None",
          inline: false,
        });
      }

      if (blacklists.globalUsers.length === 0 && blacklists.servers.length === 0 && Object.keys(blacklists.perUserCommand).length === 0) {
        embed.setDescription("No blacklists configured.");
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }
  },
};

export default command;