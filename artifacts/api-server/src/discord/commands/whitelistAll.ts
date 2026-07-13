import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  PERM_WHITELIST,
  addToGuildAllWhitelist,
  removeFromGuildAllWhitelist,
  listGuildAllWhitelist,
} from "../storage/whitelist";
import { EMOJI_SUCCESS } from "../utils/emojis";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("whitelist-all")
    .setDescription(
      "Manage who is whitelisted for every restricted command in this server.",
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Whitelist a user for every restricted command.")
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
        .setDescription("Remove a user from the all-commands whitelist.")
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
        .setDescription("Show who is whitelisted for every restricted command."),
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

    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const isAdmin =
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
      false;
    const canManage = isOwner || isAdmin || PERM_WHITELIST.has(interaction.user.id);

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
      const added = await addToGuildAllWhitelist(guildId, target.id);
      if (!added) {
        await interaction.reply({
          content: `**${target.tag}** is already on the all-commands whitelist.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(
        `${EMOJI_SUCCESS} **${target.tag}** can now use every restricted command in this server.`,
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
      const removed = await removeFromGuildAllWhitelist(guildId, target.id);
      if (!removed) {
        await interaction.reply({
          content: `**${target.tag}** wasn't on the all-commands whitelist.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(
        `🗑️ Removed **${target.tag}** from the all-commands whitelist.`,
      );
      return;
    }

    if (sub === "list") {
      const ids = await listGuildAllWhitelist(guildId);
      const permLines = [...PERM_WHITELIST].map(
        (id) => `• <@${id}> *(global)*`,
      );
      const guildLines = ids.map((id) => `• <@${id}>`);
      const description =
        [...permLines, ...guildLines].join("\n") || "*Nobody yet.*";
      const embed = new EmbedBuilder()
        .setTitle("Whitelist — all restricted commands")
        .setColor(0x2b2d31)
        .setDescription(description)
        .setFooter({
          text: `${ids.length} server entr${ids.length === 1 ? "y" : "ies"} • ${PERM_WHITELIST.size} global`,
        });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  },
};

export default command;
