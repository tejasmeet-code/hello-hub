import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";
import {
  setLock,
  removeLock,
  getLock,
  listLocks,
} from "../storage/lockedChannels";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("channel-lock")
    .setDescription("Lock a channel behind a code that users must guess.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Lock a channel. Hides it until users guess the code.")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to lock")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("code")
            .setDescription("The secret code (case-insensitive)")
            .setRequired(true)
            .setMaxLength(64),
        )
        .addStringOption((o) =>
          o
            .setName("hint")
            .setDescription("Optional hint shown publicly")
            .setRequired(false)
            .setMaxLength(200),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove the lock and restore @everyone access.")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to unlock")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List currently locked channels."),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId) return;
    const sub = interaction.options.getSubcommand(true);

    if (sub === "setup") {
      const channel = interaction.options.getChannel("channel", true) as GuildChannel;
      const code = interaction.options.getString("code", true);
      const hint = interaction.options.getString("hint") ?? undefined;

      try {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { ViewChannel: false },
          { reason: `channel-lock by ${interaction.user.tag}` },
        );
      } catch {
        await interaction.reply({
          content:
            "I couldn't change permissions on that channel. I need **Manage Channels** and a role above the channel's existing overrides.",
          ephemeral: true,
        });
        return;
      }

      await setLock(
        interaction.guildId,
        channel.id,
        code,
        interaction.user.id,
        hint,
      );

      await interaction.reply({
        content:
          `${CE.admin.str} Locked <#${channel.id}>. Users can attempt the code with \`/channel-guess channel:#${channel.name} code:<your guess>\`.` +
          (hint ? `\nHint: *${hint}*` : ""),
        ephemeral: true,
      });
      return;
    }

    if (sub === "remove") {
      const channel = interaction.options.getChannel("channel", true) as GuildChannel;
      const had = await removeLock(interaction.guildId, channel.id);
      if (!had) {
        await interaction.reply({
          content: "That channel isn't locked.",
          ephemeral: true,
        });
        return;
      }
      try {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { ViewChannel: null },
          { reason: `channel-lock removed by ${interaction.user.tag}` },
        );
      } catch {
        await interaction.reply({
          content:
            "Lock removed from storage, but I couldn't restore @everyone permissions. Check the channel manually.",
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        content: `${CE.admin.str} Unlocked <#${channel.id}>.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "list") {
      const items = await listLocks(interaction.guildId);
      if (items.length === 0) {
        await interaction.reply({
          content: "No channels are locked in this server.",
          ephemeral: true,
        });
        return;
      }
      const lines = items.map(({ channelId, entry }) => {
        const hint = entry.hint ? ` — hint: *${entry.hint}*` : "";
        return `• <#${channelId}> (set by <@${entry.createdBy}>)${hint}`;
      });
      await interaction.reply({
        content: `🔐 Locked channels:\n${lines.join("\n")}`,
        ephemeral: true,
      });
      return;
    }
  },
};

export default command;
