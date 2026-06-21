import {
  SlashCommandBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getLock, checkCode } from "../storage/lockedChannels";
import { EMOJI_ERROR, EMOJI_INFO, EMOJI_SUCCESS } from "../utils/emojis";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("channel-guess")
    .setDescription("Try to guess a locked channel's code to gain access.")
    .setDMPermission(false)
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("The locked channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("code")
        .setDescription("Your guess")
        .setRequired(true)
        .setMaxLength(64),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId) return;
    const channel = interaction.options.getChannel("channel", true) as GuildChannel;
    const code = interaction.options.getString("code", true);

    const lock = await getLock(interaction.guildId, channel.id);
    if (!lock) {
      await interaction.reply({
        content: "That channel isn't locked behind a code.",
        ephemeral: true,
      });
      return;
    }

    if (!checkCode(code, lock)) {
      const hint = lock.hint ? `\n${EMOJI_INFO} Hint: *${lock.hint}*` : "";
      await interaction.reply({
        content: `${EMOJI_ERROR} Wrong code.${hint}`,
        ephemeral: true,
      });
      return;
    }

    try {
      await channel.permissionOverwrites.edit(
        interaction.user.id,
        { ViewChannel: true },
        { reason: `channel-guess solved by ${interaction.user.tag}` },
      );
    } catch {
      await interaction.reply({
        content:
          `${EMOJI_INFO} Code is correct, but I couldn't grant you access — my role is below the channel's existing overrides. Ask an admin.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `${EMOJI_SUCCESS} Correct! Access to <#${channel.id}> granted.`,
      ephemeral: true,
    });
  },
};

export default command;
