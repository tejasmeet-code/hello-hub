import {
  ChannelType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { isManager } from "../utils/staffPerms";
import { logger } from "../../lib/logger";
import {
  clearStaffReportChannel,
  setStaffReportChannel,
} from "../storage/config";
import { postOrEditStaffReport } from "../utils/staffReportPoster";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-update-report")
    .setDescription(
      "Refresh the auto-updating staff tier report message immediately.",
    )
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription(
          "Set / change the channel where the report is auto-posted (every 2h)",
        )
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    )
    .addBooleanOption((o) =>
      o
        .setName("clear")
        .setDescription("Stop auto-updating and forget the channel")
        .setRequired(false),
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: "Run this in a server.", flags: 1 << 6 });
      return;
    }
    if (!(await isManager(interaction))) {
      await interaction.reply({ content: "You aren't allowed to manage the staff report.", flags: 1 << 6 });
      return;
    }

    const guildId = interaction.guildId;
    const clear = interaction.options.getBoolean("clear", false) ?? false;
    const channelOpt = interaction.options.getChannel("channel", false);

    if (clear) {
      await clearStaffReportChannel(guildId);
      await interaction.reply({
        content: `${CE.error.str} Auto-updating staff report disabled. The bot will stop refreshing it.`,
        flags: 1 << 6,
      });
      return;
    }

    await interaction.deferReply();

    if (channelOpt) {
      await setStaffReportChannel(guildId, channelOpt.id);
    }

    try {
      const result = await postOrEditStaffReport(interaction.client, guildId);
      if (!result.ok) {
        const messages: Record<typeof result.reason, string> = {
          "no-channel-configured":
            `${CE.error.str} No staff-report channel set. Set one via \`/config → Staff Report → Set Channel\`, or re-run with \`channel:#your-channel\`.`,
          "channel-not-found":
            `${CE.error.str} The configured channel no longer exists. Re-run with \`channel:#your-channel\`.`,
          "channel-not-text":
            `${CE.error.str} The configured channel isn't a text channel. Pick a text or announcement channel.`,
          "no-permissions":
            `${CE.error.str} I don't have permission to post in that channel. Grant **View Channel**, **Send Messages**, and **Embed Links**.`,
          "build-failed-no-roles":
            `${CE.error.str} No staff roles configured yet. Run \`/staff-role-add\` first.`,
          "build-failed-no-guild":
            `${CE.error.str} Couldn't load this server.`,
        };
        await interaction.editReply(messages[result.reason]);
        return;
      }

      await interaction.editReply(
        result.action === "posted"
          ? `${CE.success.str} Posted a fresh staff report in <#${result.channelId}>. It will refresh automatically every 2 hours.`
          : `${CE.success.str} Refreshed the staff report in <#${result.channelId}>. Auto-refresh is on every 2 hours.`,
      );
    } catch (err) {
      logger.error({ err, guildId }, "staff-update-report execute failed");
      try {
        await interaction.editReply(
          `${CE.error.str} Couldn't refresh the staff report. The server log has the details.`,
        );
      } catch {
        /* nothing left to do */
      }
    }
  },
};

export default command;