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
    .setName("whitelist-global")
    .setDescription("Manage the global (cross-server) bot whitelist.")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Grant a user global whitelist access.")
        .addStringOption((option) =>
          option
            .setName("user-id")
            .setDescription("The Discord user ID to add")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Revoke a user's global whitelist access.")
        .addStringOption((option) =>
          option
            .setName("user-id")
            .setDescription("The Discord user ID to remove")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Show everyone on the global whitelist."),
    )
    .setDMPermission(true),

  async execute(interaction: ChatInputCommandInteraction) {
    // Only existing global-whitelist members can manage the global whitelist.
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "Only globally whitelisted users can manage this list.",
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
          content: `<@${userId}> (\`${userId}\`) is already on the global whitelist.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(
        `${CE.success.str} Added <@${userId}> (\`${userId}\`) to the global whitelist.`,
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
          content: `<@${userId}> (\`${userId}\`) isn't on the global whitelist.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(
        `🗑️ Removed <@${userId}> (\`${userId}\`) from the global whitelist.`,
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
        .setTitle("Global Whitelist")
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
