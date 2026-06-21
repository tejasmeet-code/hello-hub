import {
  ChannelType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock a previously locked channel.")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to unlock (defaults to current)").setRequired(false).addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName("reason").setDescription("Reason for unlocking").setRequired(false).setMaxLength(256))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "unlock"))) return;
    if (!interaction.guild) return;

    const rawChannel = interaction.options.getChannel("channel") ?? interaction.channel;
    const reason = interaction.options.getString("reason") ?? "Channel unlocked";

    if (!rawChannel || !("permissionOverwrites" in rawChannel)) {
      await interaction.reply({ embeds: [errorEmbed("Invalid channel", "Cannot unlock that channel.")] , flags: 1 << 6 });
      return;
    }

    const ch = rawChannel as any;
    try {
      await ch.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: null },
        { reason: `Unlocked by ${interaction.user.tag}` },
      );
    } catch {
      await interaction.reply({ embeds: [errorEmbed("Failed", "Could not unlock the channel — check my permissions.")] , flags: 1 << 6 });
      return;
    }

    const unlockEmbed = prettyEmbed({
      title: "Channel unlocked",
      description: `${CE.success.str}\n\n${buildBullets([
        { label: "Channel",     value: `<#${rawChannel.id}>` },
        { label: "Unlocked by", value: `<@${interaction.user.id}>` },
      ])}`,
      color: COLORS.success,
    });

    await interaction.reply({ embeds: [unlockEmbed], ephemeral: false });
    if (rawChannel.id !== interaction.channelId) {
      await ch.send({ embeds: [unlockEmbed] }).catch(() => {});
    }
  },
};

export default command;