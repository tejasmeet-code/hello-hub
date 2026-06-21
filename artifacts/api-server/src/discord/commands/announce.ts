import {
  ActionRowBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildTextBasedChannel,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed, infoEmbed } from "../utils/embedStyle";
import {
  createScheduledAnnounce,
  getScheduledForGuild,
  deleteScheduledAnnounce,
  toUtcTimestamp,
} from "../storage/scheduled-announces";

const COLOR_MAP: Record<string, number> = {
  blue:   COLORS.primary,
  green:  COLORS.success,
  red:    COLORS.danger,
  yellow: COLORS.warning,
  purple: COLORS.staff,
};

const TIMEZONES = [
  { name: "UTC",                    value: "UTC" },
  { name: "US Eastern  (ET)",       value: "America/New_York" },
  { name: "US Central  (CT)",       value: "America/Chicago" },
  { name: "US Mountain (MT)",       value: "America/Denver" },
  { name: "US Pacific  (PT)",       value: "America/Los_Angeles" },
  { name: "UK  (GMT/BST)",          value: "Europe/London" },
  { name: "Central Europe (CET)",   value: "Europe/Paris" },
  { name: "India  (IST)",           value: "Asia/Kolkata" },
  { name: "Japan  (JST)",           value: "Asia/Tokyo" },
  { name: "Australia Sydney (AEDT)", value: "Australia/Sydney" },
];

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post or schedule a formatted announcement embed.")
    .addSubcommand(sub => sub
      .setName("post")
      .setDescription("Post an announcement immediately.")
      .addChannelOption(o => o.setName("channel").setDescription("Channel to post in").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption(o => o.setName("color").setDescription("Embed color").setRequired(false).addChoices(
        { name: "Blue (default)", value: "blue" },
        { name: "Green",          value: "green" },
        { name: "Red",            value: "red" },
        { name: "Yellow",         value: "yellow" },
        { name: "Purple",         value: "purple" },
      ))
      .addBooleanOption(o => o.setName("ping_everyone").setDescription("Ping @everyone").setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName("schedule")
      .setDescription("Schedule an announcement for a future date and time.")
      .addChannelOption(o => o.setName("channel").setDescription("Channel to post in").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption(o => o.setName("date").setDescription("Date to send (YYYY-MM-DD, e.g. 2026-05-15)").setRequired(true).setMaxLength(10))
      .addStringOption(o => o.setName("time").setDescription("Time to send (HH:MM 24h, e.g. 14:30)").setRequired(true).setMaxLength(5))
      .addStringOption(o => o.setName("timezone").setDescription("Timezone").setRequired(true).addChoices(...TIMEZONES))
      .addStringOption(o => o.setName("color").setDescription("Embed color").setRequired(false).addChoices(
        { name: "Blue (default)", value: "blue" },
        { name: "Green",          value: "green" },
        { name: "Red",            value: "red" },
        { name: "Yellow",         value: "yellow" },
        { name: "Purple",         value: "purple" },
      ))
      .addBooleanOption(o => o.setName("ping_everyone").setDescription("Ping @everyone when sent").setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName("list")
      .setDescription("List all scheduled announcements for this server.")
    )
    .addSubcommand(sub => sub
      .setName("cancel")
      .setDescription("Cancel a scheduled announcement by ID.")
      .addStringOption(o => o.setName("id").setDescription("Scheduled announcement ID (from /announce list)").setRequired(true))
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "announce"))) return;
    if (!interaction.guildId || !interaction.guild) return;

    const sub = interaction.options.getSubcommand();

    // ── /announce post ────────────────────────────────────────────────────────
    if (sub === "post") {
      const channel = interaction.options.getChannel("channel", true) as GuildTextBasedChannel;
      const color   = COLOR_MAP[interaction.options.getString("color") ?? "blue"] ?? COLORS.primary;
      const pingEveryone = interaction.options.getBoolean("ping_everyone") ?? false;

      const postModal = new ModalBuilder()
        .setCustomId("announce:post:modal")
        .setTitle("Post Announcement");
      
      postModal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Announcement Title")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(256),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("message")
            .setLabel("Announcement Message")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000),
        ),
      );

      await interaction.showModal(postModal);
      let postSubmit;
      try {
        postSubmit = await interaction.awaitModalSubmit({
          filter: (s) => s.customId === "announce:post:modal" && s.user.id === interaction.user.id,
          time: 5 * 60 * 1000,
        });
      } catch { return; }

      const title = postSubmit.fields.getTextInputValue("title").trim();
      const message = postSubmit.fields.getTextInputValue("message").trim();

      await postSubmit.deferReply({ flags: 1 << 6 });

      try {
        await channel.send({
          content: pingEveryone ? "@everyone" : undefined,
          embeds: [prettyEmbed({
            title,
            description: message,
            color,
            footer: `Announced by ${postSubmit.user.tag} • Relosta Bot`,
          })],
        });
      } catch {
        await postSubmit.editReply({ embeds: [errorEmbed("Failed", "Could not post to that channel — check my permissions.")] });
        return;
      }

      await postSubmit.editReply({ embeds: [prettyEmbed({
        title: "Announcement posted",
        description: `${CE.success.str}\n\n${buildBullets([
          { label: "Channel", value: `<#${channel.id}>` },
          { label: "Title",   value: title },
        ])}`,
        color: COLORS.success,
        footer: "Relosta Bot",
      })] });
      return;
    }

    // ── /announce schedule ────────────────────────────────────────────────────
    if (sub === "schedule") {
      const channel = interaction.options.getChannel("channel", true) as GuildTextBasedChannel;
      const dateStr  = interaction.options.getString("date", true).trim();
      const timeStr  = interaction.options.getString("time", true).trim();
      const tz       = interaction.options.getString("timezone", true);
      const color    = COLOR_MAP[interaction.options.getString("color") ?? "blue"] ?? COLORS.primary;
      const pingEveryone = interaction.options.getBoolean("ping_everyone") ?? false;

      const schedModal = new ModalBuilder()
        .setCustomId("announce:schedule:modal")
        .setTitle("Schedule Announcement");
      
      schedModal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Announcement Title")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(256),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("message")
            .setLabel("Announcement Message")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000),
        ),
      );

      await interaction.showModal(schedModal);
      let schedSubmit;
      try {
        schedSubmit = await interaction.awaitModalSubmit({
          filter: (s) => s.customId === "announce:schedule:modal" && s.user.id === interaction.user.id,
          time: 5 * 60 * 1000,
        });
      } catch { return; }

      const title = schedSubmit.fields.getTextInputValue("title").trim();
      const message = schedSubmit.fields.getTextInputValue("message").trim();

      await schedSubmit.deferReply({ flags: 1 << 6 });

      const scheduledFor = toUtcTimestamp(dateStr, timeStr, tz);
      if (!scheduledFor) {
        await schedSubmit.editReply({ embeds: [errorEmbed(
          "Invalid date/time",
          "Could not parse the date or time. Use **YYYY-MM-DD** for date and **HH:MM** (24h) for time, and make sure it's in the future.",
        )] });
        return;
      }

      const entry = await createScheduledAnnounce({
        guildId: interaction.guildId,
        channelId: channel.id,
        title, message, color, pingEveryone,
        scheduledFor, timezone: tz,
        createdBy: interaction.user.id,
        createdByTag: interaction.user.tag,
      });

      const sendAt = new Date(scheduledFor);
      const readableUtc = sendAt.toUTCString();
      const tzLabel = TIMEZONES.find(t => t.value === tz)?.name ?? tz;

      await schedSubmit.editReply({ embeds: [prettyEmbed({
        title: "Announcement scheduled",
        description: `${CE.success.str}\n\n${buildBullets([
          { label: "Channel",  value: `<#${channel.id}>` },
          { label: "Title",    value: title },
          { label: "Date",     value: `${dateStr} at ${timeStr} (${tzLabel})` },
          { label: "Sends at", value: `${readableUtc}` },
          { label: "ID",       value: `\`${entry.id}\`` },
        ])}`,
        color: COLORS.info,
        footer: "Use /announce cancel to remove it • Relosta Bot",
      })] });
      return;
    }

    // ── /announce list ────────────────────────────────────────────────────────
    if (sub === "list") {
      await interaction.deferReply({ flags: 1 << 6 });
      const all = await getScheduledForGuild(interaction.guildId);

      if (all.length === 0) {
        await interaction.editReply({ embeds: [infoEmbed("No scheduled announcements", "Use `/announce schedule` to queue one.")] });
        return;
      }

      const lines = all.slice(0, 15).map((e: any) => {
        const tzLabel = TIMEZONES.find(t => t.value === e.timezone)?.name ?? e.timezone;
        const d = new Date(e.scheduledFor);
        return `• \`${e.id}\` — **${e.title.slice(0, 40)}** in <#${e.channelId}>\n  ↳ ${d.toUTCString()} (${tzLabel})`;
      });

      await interaction.editReply({ embeds: [prettyEmbed({
        title: `Scheduled Announcements — ${all.length}`,
        description: lines.join("\n\n"),
        color: COLORS.info,
        footer: "Use /announce cancel <id> to remove one • Relosta Bot",
      })] });
      return;
    }

    // ── /announce cancel ──────────────────────────────────────────────────────
    if (sub === "cancel") {
      const id = interaction.options.getString("id", true).trim();
      await interaction.deferReply({ flags: 1 << 6 });

      const deleted = deleteScheduledAnnounce(interaction.guildId, id);
      if (!deleted) {
        await interaction.editReply({ embeds: [errorEmbed("Not found", `No scheduled announcement with ID \`${id}\` exists in this server.`)] });
        return;
      }

      await interaction.editReply({ embeds: [prettyEmbed({
        title: "Announcement cancelled",
        description: `${CE.success.str} Scheduled announcement \`${id}\` has been removed.`,
        color: COLORS.success,
        footer: "Relosta Bot",
      })] });
    }
  },
};

export default command;
