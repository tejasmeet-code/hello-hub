import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock a channel — prevents @everyone from sending messages.")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to lock (defaults to current)").setRequired(false).addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the lock").setRequired(false).setMaxLength(256))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "lock"))) return;
    if (!interaction.guild) return;

    const rawChannel = interaction.options.getChannel("channel") ?? interaction.channel;
    const reason = interaction.options.getString("reason") ?? "Channel locked";

    if (!rawChannel || !("permissionOverwrites" in rawChannel)) {
      await interaction.reply({ embeds: [errorEmbed("Invalid channel", "Cannot lock that channel.")] , flags: 1 << 6 });
      return;
    }

    const ch = rawChannel as any;
    try {
      await ch.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false },
        { reason: `Locked by ${interaction.user.tag}: ${reason}` },
      );
    } catch {
      await interaction.reply({ embeds: [errorEmbed("Failed", "Could not lock the channel — check my permissions.")] , flags: 1 << 6 });
      return;
    }

    const lockEmbed = prettyEmbed({
      title: "Channel locked",
      description: `${CE.admin.str}\n\n${buildBullets([
        { label: "Reason",    value: reason },
        { label: "Locked by", value: `<@${interaction.user.id}>` },
      ])}`,
      color: COLORS.danger,
      footer: "Use /unlock to re-open this channel",
    });

    await interaction.reply({ embeds: [lockEmbed], ephemeral: false });
    if (rawChannel.id !== interaction.channelId) {
      await ch.send({ embeds: [lockEmbed] }).catch(() => {});
    }
  },
};

export default command;