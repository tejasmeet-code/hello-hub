import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk-delete messages from this channel.")
    .addIntegerOption(o => o.setName("amount").setDescription("Number of messages to delete (1–100)").setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName("user").setDescription("Only delete messages from this user").setRequired(false))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "purge"))) return;
    if (!interaction.channel || !("bulkDelete" in interaction.channel)) {
      await interaction.reply({ embeds: [errorEmbed("Invalid channel", "Purge can only be used in a text channel.")] , flags: 1 << 6 });
      return;
    }

    const amount = interaction.options.getInteger("amount", true);
    const filterUser = interaction.options.getUser("user");
    await interaction.deferReply({ flags: 1 << 6 });

    const channel = interaction.channel as GuildTextBasedChannel;
    const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!fetched) {
      await interaction.editReply({ embeds: [errorEmbed("Failed", "Could not fetch messages.")] });
      return;
    }

    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const toDelete = [...fetched.values()]
      .filter(m => m.createdTimestamp > twoWeeksAgo)
      .filter(m => !filterUser || m.author.id === filterUser.id)
      .slice(0, amount);

    if (toDelete.length === 0) {
      await interaction.editReply({ embeds: [errorEmbed("Nothing to delete", "No deletable messages found (messages must be under 14 days old).")] });
      return;
    }

    const deleted = await channel.bulkDelete(toDelete, true).catch(() => null);
    const count = deleted?.size ?? toDelete.length;

    await interaction.editReply({
      embeds: [prettyEmbed({
        title: "Purge complete",
        description: `${CE.success.str}\n\n${buildBullets([
          { label: "Deleted",  value: `**${count}** message${count === 1 ? "" : "s"}` },
          { label: "Channel",  value: `<#${channel.id}>` },
          ...(filterUser ? [{ label: "Filter", value: filterUser.tag }] : []),
        ])}`,
        color: COLORS.success,
      })],
    });
  },
};

export default command;