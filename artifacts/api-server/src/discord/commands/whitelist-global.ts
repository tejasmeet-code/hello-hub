import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";
import {
  PERM_WHITELIST,
  addToPermWhitelist,
  removeFromPermWhitelist,
  listPermWhitelist,
  isInBasePermWhitelist,
} from "../storage/whitelist";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("bot-admins")
    .setDescription("Manage Bot Admin global access (can use any command across any server).")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Grant a user Bot Admin global access.")
        .addStringOption((option) =>
          option
            .setName("user-id")
            .setDescription("The Discord user ID to add as Bot Admin")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Revoke a user's Bot Admin global access.")
        .addStringOption((option) =>
          option
            .setName("user-id")
            .setDescription("The Discord user ID to remove from Bot Admins")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Show everyone with Bot Admin access."),
    )
    .setDMPermission(true),

  async execute(interaction: ChatInputCommandInteraction) {
    // Only existing Bot Admins can manage the Bot Admin list.
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "Only existing Bot Admins can manage this list.",
        ephemeral: true,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "add") {
      const userId = interaction.options.getString("user-id", true).trim();
      if (!/^\d{15,25}$/.test(userId)) {
        await interaction.reply({
          content:
            "That doesn't look like a valid Discord user ID (expected 15–25 digits).",
          ephemeral: true,
        });
        return;
      }
      const added = await addToPermWhitelist(userId);
      if (!added) {
        await interaction.reply({
          content: `<@${userId}> (\`${userId}\`) is already a Bot Admin.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(
        `${CE.success.str} Added <@${userId}> (\`${userId}\`) as a Bot Admin (global access to all commands).`,
      );
      return;
    }

    if (sub === "remove") {
      const userId = interaction.options.getString("user-id", true).trim();
      if (!/^\d{15,25}$/.test(userId)) {
        await interaction.reply({
          content:
            "That doesn't look like a valid Discord user ID (expected 15–25 digits).",
          ephemeral: true,
        });
        return;
      }
      if (isInBasePermWhitelist(userId)) {
        await interaction.reply({
          content: `<@${userId}> (\`${userId}\`) is part of the hardcoded baseline and can't be removed at runtime.`,
          ephemeral: true,
        });
        return;
      }
      const removed = await removeFromPermWhitelist(userId);
      if (!removed) {
        await interaction.reply({
          content: `<@${userId}> (\`${userId}\`) isn't a Bot Admin.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(
        `🗑️ Removed <@${userId}> (\`${userId}\`) from Bot Admins.`,
      );
      return;
    }

    if (sub === "list") {
      const { base, extras } = await listPermWhitelist();
      const baseLines = base.map((id) => `• <@${id}> \`${id}\` *(baseline)*`);
      const extraLines = extras.map((id) => `• <@${id}> \`${id}\``);
      const description =
        [...baseLines, ...extraLines].join("\n") || "*Nobody yet.*";
      const embed = new EmbedBuilder()
        .setTitle("Bot Admins (Global Access)")
        .setColor(0x2b2d31)
        .setDescription(description)
        .setFooter({
          text: `${base.length} baseline • ${extras.length} runtime • ${PERM_WHITELIST.size} total`,
        });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  },
};

export default command;
