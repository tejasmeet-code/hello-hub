import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { sendGlobalBotNotification, type GlobalNotificationPayload } from "../utils/globalNotification";
import { errorEmbed, CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("bot-announce")
    .setDescription("[Bot Admin only] Announce a message to set bot notification channel in every server.")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Announcement format mode")
        .setRequired(true)
        .addChoices(
          { name: "Embed Only", value: "embed" },
          { name: "Text Only", value: "text" },
          { name: "Both (Text + Embed)", value: "both" }
        )
    )
    .addStringOption((o) =>
      o.setName("message").setDescription("Announcement text / embed description").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("title").setDescription("Optional embed title").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("text_above").setDescription("Optional text above embed (for Both mode)").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("image_url").setDescription("Optional image URL for embed").setRequired(false)
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        embeds: [errorEmbed("Access Denied", "This command is restricted to Bot Admins.")],
        flags: 1 << 6,
      });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    const mode = interaction.options.getString("mode", true) as "embed" | "text" | "both";
    const message = interaction.options.getString("message", true);
    const title = interaction.options.getString("title") ?? undefined;
    const textAbove = interaction.options.getString("text_above") ?? undefined;
    const imageUrl = interaction.options.getString("image_url") ?? undefined;

    const payload: GlobalNotificationPayload = {
      mode,
      message,
      title,
      textAbove,
      imageUrl,
    };

    const res = await sendGlobalBotNotification(interaction.client, payload);

    const resultEmbed = new EmbedBuilder()
      .setTitle(`${CE.announce.str} Global Bot Announcement Sent`)
      .setColor(0x57f287)
      .addFields(
        { name: "Servers Notified", value: `${res.sentCount}`, inline: true },
        { name: "Failed / No Channel", value: `${res.failCount}`, inline: true },
        { name: "Format Mode", value: mode.toUpperCase(), inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [resultEmbed] });
  },
};

export default command;
