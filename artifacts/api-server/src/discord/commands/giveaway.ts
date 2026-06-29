import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import {
  createGiveaway,
  getGiveawayByMessage,
  getGuildGiveaways,
  updateGiveaway,
  type Giveaway,
} from "../storage/giveaways";
import { COLORS, CE } from "../utils/embedStyle";

function parseDuration(raw: string): number | null {
  const map: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const match = raw.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const val = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  return val * (map[unit] ?? 0);
}

export function buildGiveawayEmbed(g: Giveaway): EmbedBuilder {
  const endsIn = g.endsAt - Date.now();
  const status = g.ended
    ? `${CE.error.str} Ended`
    : endsIn > 0
    ? `${CE.loading.str} Ends <t:${Math.floor(g.endsAt / 1000)}:R>`
    : `${CE.error.str} Ended`;

  return new EmbedBuilder()
    .setTitle(`${CE.giveaway.str} ${g.prize}`)
    .setColor(g.ended ? 0xed4245 : 0xfee75c)
    .setDescription(
      [
        g.description ?? "",
        "",
        `**${CE.members.str} Winners:** ${g.winnerCount}`,
        `**${CE.staff.str} Hosted by:** <@${g.hostId}>`,
        g.requiredRoleId ? `**${CE.warning.str} Required role:** <@&${g.requiredRoleId}>` : null,
        g.bonusRoleId ? `**${CE.success.str} Bonus entries:** <@&${g.bonusRoleId}> gets ${g.bonusEntries ?? 2}x entries` : null,
        "",
        status,
        g.ended && g.winnerIds.length > 0
          ? `**${CE.success.str} Winner${g.winnerIds.length > 1 ? "s" : ""}:** ${g.winnerIds.map((id) => `<@${id}>`).join(", ")}`
          : g.ended
          ? `*No valid entries*`
          : null,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    )
    .setFooter({ text: `${g.winnerCount} winner${g.winnerCount !== 1 ? "s" : ""} • ID: ${g.giveawayId}` })
    .setTimestamp(g.ended ? undefined : new Date(g.endsAt));
}

function enterRow(giveawayId: string): ActionRowBuilder<any> {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw:enter:${giveawayId}`)
      .setLabel("Enter Giveaway")
      .setStyle(ButtonStyle.Primary),
  );
}

async function pickWinners(
  g: Giveaway,
  channel: GuildTextBasedChannel,
): Promise<string[]> {
  let msg;
  try {
    msg = await channel.messages.fetch(g.messageId);
  } catch {
    return [];
  }

  // Collect reactions or use participant list from button clicks
  // Since we track enters via buttons, we'll use reaction-based approach for simplicity
  const reaction = msg.reactions.cache.get("🎉") ?? msg.reactions.cache.first();
  if (!reaction) return [];

  const users = await reaction.users.fetch().catch(() => null);
  if (!users) return [];

  let pool = [...users.values()].filter((u) => !u.bot);

  // Filter required role
  if (g.requiredRoleId && channel.guild) {
    const roleMembers = channel.guild.roles.cache.get(g.requiredRoleId)?.members;
    if (roleMembers) {
      pool = pool.filter((u) => roleMembers.has(u.id));
    }
  }

  // Bonus entries — add extra entries for bonus role members
  if (g.bonusRoleId && channel.guild) {
    const bonusMembers = channel.guild.roles.cache.get(g.bonusRoleId)?.members;
    const extra = g.bonusEntries ?? 2;
    if (bonusMembers) {
      const expanded: typeof pool = [];
      for (const u of pool) {
        expanded.push(u);
        if (bonusMembers.has(u.id)) {
          for (let i = 1; i < extra; i++) expanded.push(u);
        }
      }
      pool = expanded;
    }
  }

  // Shuffle and pick winners (unique)
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const winners: string[] = [];
  const seen = new Set<string>();
  for (const u of shuffled) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    winners.push(u.id);
    if (winners.length >= g.winnerCount) break;
  }
  return winners;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Manage giveaways.")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Start a new giveaway.")
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel to post in").setRequired(true)
            .addChannelTypes(ChannelType.GuildText),
        )
        .addStringOption((o) =>
          o.setName("duration").setDescription("Duration e.g. 1h, 30m, 2d").setRequired(true),
        )
        .addStringOption((o) => o.setName("prize").setDescription("What you are giving away").setRequired(true))
        .addIntegerOption((o) =>
          o.setName("winners").setDescription("Number of winners (default 1)").setMinValue(1).setMaxValue(20),
        )
        .addRoleOption((o) => o.setName("required-role").setDescription("Role required to enter"))
        .addRoleOption((o) => o.setName("bonus-role").setDescription("Role that gets bonus entries"))
        .addIntegerOption((o) =>
          o.setName("bonus-entries").setDescription("How many entries the bonus role gets (default 2)").setMinValue(2).setMaxValue(10),
        )
        .addStringOption((o) => o.setName("description").setDescription("Extra description text")),
    )
    .addSubcommand((s) =>
      s
        .setName("end")
        .setDescription("End a giveaway early and pick winners.")
        .addStringOption((o) =>
          o.setName("message-id").setDescription("Message ID of the giveaway").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("reroll")
        .setDescription("Reroll winners for an ended giveaway.")
        .addStringOption((o) =>
          o.setName("message-id").setDescription("Message ID of the giveaway").setRequired(true),
        )
        .addIntegerOption((o) =>
          o.setName("winners").setDescription("How many winners to reroll (default all)").setMinValue(1).setMaxValue(20),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("List active giveaways in this server."),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "giveaway"))) return;
    if (!interaction.guild || !interaction.guildId) return;

    const sub = interaction.options.getSubcommand();

    // ── /giveaway start ──────────────────────────────────────────────────────
    if (sub === "start") {
      const channel = interaction.options.getChannel("channel", true) as GuildTextBasedChannel;
      const durationRaw = interaction.options.getString("duration", true);
      const prize = interaction.options.getString("prize", true);
      const winnerCount = interaction.options.getInteger("winners") ?? 1;
      const requiredRole = interaction.options.getRole("required-role");
      const bonusRole = interaction.options.getRole("bonus-role");
      const bonusEntries = interaction.options.getInteger("bonus-entries") ?? 2;
      const description = interaction.options.getString("description");

      const durationMs = parseDuration(durationRaw);
      if (!durationMs || durationMs < 10_000) {
        await interaction.reply({
          content: `${CE.error.str} Invalid duration. Use format like \`30m\`, \`2h\`, \`1d\`. Minimum 10 seconds.`,
          flags: 1 << 6,
        });
        return;
      }
      if (durationMs > 30 * 24 * 3_600_000) {
        await interaction.reply({ content: `${CE.error.str} Maximum giveaway duration is 30 days.`, flags: 1 << 6 });
        return;
      }

      await interaction.deferReply();

      const giveawayId = `${interaction.guildId}-${Date.now()}`;
      const endsAt = Date.now() + durationMs;

      const tempGiveaway: Giveaway = {
        giveawayId,
        guildId: interaction.guildId,
        channelId: channel.id,
        messageId: "",
        prize,
        winnerCount,
        hostId: interaction.user.id,
        endsAt,
        ended: false,
        winnerIds: [],
        requiredRoleId: requiredRole?.id,
        bonusRoleId: bonusRole?.id,
        bonusEntries: bonusRole ? bonusEntries : undefined,
        description: description ?? undefined,
      };

      const embed = buildGiveawayEmbed(tempGiveaway);

      let msg;
      try {
        msg = await channel.send({
          embeds: [embed],
          components: [enterRow(giveawayId)],
        });
      } catch {
        await interaction.editReply(`${CE.error.str} Failed to send giveaway message. Check my permissions in ${channel}.`);
        return;
      }

      const giveaway: Giveaway = { ...tempGiveaway, messageId: msg.id };
      await createGiveaway(giveaway);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle(`${CE.success.str} Giveaway Started`)
            .addFields(
              { name: "Prize", value: prize, inline: true },
              { name: "Channel", value: `${channel}`, inline: true },
              { name: "Ends", value: `<t:${Math.floor(endsAt / 1000)}:R>`, inline: true },
              { name: "Winners", value: `${winnerCount}`, inline: true },
              { name: "Message ID", value: `\`${msg.id}\``, inline: true },
            ),
        ],
      });
      return;
    }

    // ── /giveaway end ────────────────────────────────────────────────────────
    if (sub === "end") {
      const messageId = interaction.options.getString("message-id", true);
      await interaction.deferReply();

      const g = await getGiveawayByMessage(messageId);
      if (!g || g.guildId !== interaction.guildId) {
        await interaction.editReply(`${CE.error.str} Giveaway not found.`);
        return;
      }
      if (g.ended) {
        await interaction.editReply(`${CE.error.str} That giveaway already ended.`);
        return;
      }

      const channel = interaction.guild.channels.cache.get(g.channelId) as GuildTextBasedChannel | undefined;
      if (!channel) {
        await interaction.editReply(`${CE.error.str} Couldn't find the giveaway channel.`);
        return;
      }

      const winners = await pickWinners(g, channel);
      const updated = await updateGiveaway(g.giveawayId, (gw) => ({
        ...gw,
        ended: true,
        endsAt: Date.now(),
        winnerIds: winners,
      }));
      if (!updated) return;

      const msg = await channel.messages.fetch(g.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [buildGiveawayEmbed(updated)], components: [] }).catch(() => {});
        await msg.reply(
          winners.length > 0
            ? `${CE.giveaway.str} Congratulations ${winners.map((id) => `<@${id}>`).join(", ")}! You won **${g.prize}**!`
            : `No valid entries — could not pick a winner for **${g.prize}**.`,
        ).catch(() => {});
      }

      await interaction.editReply(
        winners.length > 0
          ? `${CE.success.str} Giveaway ended. Winners: ${winners.map((id) => `<@${id}>`).join(", ")}`
          : `${CE.warning.str} Giveaway ended with no valid entries.`,
      );
      return;
    }

    // ── /giveaway reroll ─────────────────────────────────────────────────────
    if (sub === "reroll") {
      const messageId = interaction.options.getString("message-id", true);
      const numWinners = interaction.options.getInteger("winners");
      await interaction.deferReply();

      const g = await getGiveawayByMessage(messageId);
      if (!g || g.guildId !== interaction.guildId) {
        await interaction.editReply(`${CE.error.str} Giveaway not found.`);
        return;
      }
      if (!g.ended) {
        await interaction.editReply(`${CE.error.str} Giveaway hasn't ended yet. Use \`/giveaway end\` first.`);
        return;
      }

      const channel = interaction.guild.channels.cache.get(g.channelId) as GuildTextBasedChannel | undefined;
      if (!channel) {
        await interaction.editReply(`${CE.error.str} Couldn't find the giveaway channel.`);
        return;
      }

      const rollG = numWinners ? { ...g, winnerCount: numWinners } : g;
      const winners = await pickWinners(rollG, channel);

      await updateGiveaway(g.giveawayId, (gw) => ({ ...gw, winnerIds: winners }));

      const msg = await channel.messages.fetch(g.messageId).catch(() => null);
      if (msg) {
        await msg.reply(
          winners.length > 0
            ? `${CE.giveaway.str} **Reroll!** New winner${winners.length > 1 ? "s" : ""}: ${winners.map((id) => `<@${id}>`).join(", ")} for **${g.prize}**!`
            : `Reroll failed — no valid entries found.`,
        ).catch(() => {});
      }

      await interaction.editReply(
        winners.length > 0
          ? `${CE.success.str} Rerolled! New winners: ${winners.map((id) => `<@${id}>`).join(", ")}`
          : `${CE.warning.str} No valid entries found for reroll.`,
      );
      return;
    }

    // ── /giveaway list ───────────────────────────────────────────────────────
    if (sub === "list") {
      await interaction.deferReply();
      const giveaways = await getGuildGiveaways(interaction.guildId);
      const active = giveaways.filter((g) => !g.ended);
      const ended = giveaways.filter((g) => g.ended).slice(0, 5);

      const embed = new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle(`${CE.giveaway.str} Giveaways`)
        .setDescription(
          active.length === 0 && ended.length === 0
            ? "*No giveaways found.*"
            : null,
        );

      if (active.length > 0) {
        embed.addFields({
          name: `${CE.success.str} Active (${active.length})`,
          value: active
            .map(
              (g) =>
                `• **${g.prize}** — ${g.winnerCount}W — <t:${Math.floor(g.endsAt / 1000)}:R> — <#${g.channelId}> — \`${g.messageId}\``,
            )
            .join("\n"),
        });
      }
      if (ended.length > 0) {
        embed.addFields({
          name: `${CE.error.str} Recently Ended (${ended.length})`,
          value: ended
            .map(
              (g) =>
                `• **${g.prize}** — ${g.winnerIds.length > 0 ? g.winnerIds.map((id) => `<@${id}>`).join(", ") : "No winners"} — \`${g.messageId}\``,
            )
            .join("\n"),
        });
      }

      await interaction.editReply({ embeds: [embed] });
    }
  },
};

export default command;
