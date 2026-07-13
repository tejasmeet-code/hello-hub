import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { isAdminOrOwner } from "../utils/staffPerms";
import { CE } from "../utils/embedStyle";
import {
  getResponseChannelId,
  setResponseChannelId,
  clearResponseChannelId,
} from "../storage/responseChannel";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("response-channel")
    .setDescription("Configure the channel where all bot DMs are forwarded.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set the channel to forward DMs to.")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Text channel to receive DM notifications")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Stop forwarding DMs (disable the response channel)."),
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show the currently configured response channel."),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Run this in a server.", ephemeral: true });
      return;
    }
    if (!isAdminOrOwner(interaction) && !PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "Only administrators can configure the response channel.",
        ephemeral: true,
      });
      return;
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === "set") {
      const channel = interaction.options.getChannel("channel", true);
      await setResponseChannelId(channel.id);
      await interaction.reply({
        content: `${CE.success.str} DMs to the bot will now be forwarded to <#${channel.id}>.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "clear") {
      await clearResponseChannelId();
      await interaction.reply({
        content: `${CE.success.str} DM forwarding disabled.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "status") {
      const id = await getResponseChannelId();
      await interaction.reply({
        content: id
          ? `${CE.information.str} DMs are currently forwarded to <#${id}>.`
          : `${CE.warning.str} No response channel is set. Use \`/response-channel set\` to configure one.`,
        ephemeral: true,
      });
      return;
    }
  },
};

export default command;
