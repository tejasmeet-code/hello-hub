import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getGuildConfig, updateGuildConfig } from "../storage/config";
import { CE } from "../utils/embedStyle";

export const autoReactCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("auto-react")
    .setDescription("Configure custom emoji auto-reactions for specific Users, Channels, or Categories.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add an auto-reaction mapping.")
        .addStringOption((o) =>
          o
            .setName("target_type")
            .setDescription("Target type")
            .setRequired(true)
            .addChoices(
              { name: "User ID", value: "user" },
              { name: "Channel ID", value: "channel" },
              { name: "Category ID", value: "category" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("target_id")
            .setDescription("The Discord ID of the User, Channel, or Category")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("emoji")
            .setDescription("Custom emoji string or Unicode emoji")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List all active auto-reaction mappings."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove an auto-reaction mapping by ID.")
        .addStringOption((o) =>
          o
            .setName("id")
            .setDescription("Mapping ID from /auto-react list")
            .setRequired(true),
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const cfg = await getGuildConfig(guildId);
    const mappings = cfg.autoReactMappings ?? [];

    if (sub === "add") {
      const targetType = interaction.options.getString("target_type", true) as "user" | "channel" | "category";
      const targetId = interaction.options.getString("target_id", true).trim();
      const emoji = interaction.options.getString("emoji", true).trim();

      const mappingId = Math.random().toString(36).substring(2, 8);
      const newMapping = { id: mappingId, targetType, targetId, emoji };

      await updateGuildConfig(guildId, (c) => ({
        ...c,
        autoReactMappings: [...(c.autoReactMappings ?? []), newMapping],
      }));

      const embed = new EmbedBuilder()
        .setTitle(`${CE.success.str} Auto-Reaction Added`)
        .setDescription(`Whenever a message matches **${targetType.toUpperCase()}** \`${targetId}\`, the bot will react with ${emoji}.`)
        .setColor(0x57f287);
      await interaction.reply({ embeds: [embed] });
    } else if (sub === "list") {
      if (mappings.length === 0) {
        await interaction.reply({ content: "No auto-reactions configured yet.", ephemeral: true });
        return;
      }

      const listStr = mappings
        .map((m) => `• **ID:** \`${m.id}\` | **Target (${m.targetType}):** \`${m.targetId}\` | **Emoji:** ${m.emoji}`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`${CE.settings.str} Active Auto-Reactions`)
        .setDescription(listStr)
        .setColor(0x2b2d31);
      await interaction.reply({ embeds: [embed] });
    } else if (sub === "remove") {
      const id = interaction.options.getString("id", true).trim();
      const nextMappings = mappings.filter((m) => m.id !== id);

      if (nextMappings.length === mappings.length) {
        await interaction.reply({ content: "Mapping ID not found.", ephemeral: true });
        return;
      }

      await updateGuildConfig(guildId, (c) => ({
        ...c,
        autoReactMappings: nextMappings,
      }));

      const embed = new EmbedBuilder()
        .setTitle(`${CE.success.str} Auto-Reaction Removed`)
        .setDescription(`Removed mapping ID \`${id}\`.`)
        .setColor(0x57f287);
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default autoReactCommand;
