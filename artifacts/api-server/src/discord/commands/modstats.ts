import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { COLORS, EMOJI, prettyEmbed } from "../utils/embedStyle";
import {
  summarizeMod,
  type ModSummary,
  type StatScope,
} from "../storage/modstats";
import { getGuildConfig } from "../storage/config";

const SCOPE_LABELS: Record<StatScope, string> = {
  this_week: "This week",
  last_week: "Last week",
  all_time: "All time",
};

function renderSingle(summary: ModSummary): string {
  const lines: string[] = [
    `**Net score:** ${summary.total}`,
    `**Actions:** ${summary.positive}  •  **Reversals:** ${summary.negative}`,
    "",
    "**Breakdown:**",
  ];
  for (const action of [
    "ban",
    "unban",
    "mute",
    "unmute",
    "warn",
    "unwarn",
    "jail",
    "unjail",
  ] as const) {
    const slot = summary.byAction[action];
    if (slot.positive === 0 && slot.negative === 0) continue;
    lines.push(
      `${EMOJI.bullet} **/${action}** — +${slot.positive} / -${slot.negative} (net **${slot.net}**)`,
    );
  }
  if (lines.length === 4) lines.push("*No actions recorded.*");
  return lines.join("\n");
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("modstats")
    .setDescription("View a single moderator's action stats with a timeframe picker.")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Moderator to inspect (defaults to you)")
        .setRequired(false),
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: "Run this in a server.", flags: 1 << 6 });
      return;
    }

    const target = interaction.options.getUser("user", false) ?? interaction.user;
    if (target.bot) {
      await interaction.reply({ content: "Bots don't have mod stats.", flags: 1 << 6 });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    const cfg = await getGuildConfig(interaction.guildId);
    const weekStartDay = cfg.quotaConfig?.weekStartDay ?? 0;
    const initialScope = "this_week" as StatScope;

    const buildEmbed = async (scope: StatScope) => {
      const summary = await summarizeMod(
        interaction.guildId!,
        target.id,
        scope,
        weekStartDay,
      );
      return prettyEmbed({
        title: `Modstats — ${target.tag}`,
        description: renderSingle(summary),
        color: COLORS.staff,
        thumbnail: target.displayAvatarURL({ size: 256 }),
        footer: `Timeframe: ${SCOPE_LABELS[scope]}`,
      });
    };

    const select = new StringSelectMenuBuilder()
      .setCustomId(`modstats:${interaction.user.id}:${target.id}`)
      .setPlaceholder("Select timeframe")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("This week")
          .setValue("this_week")
          .setDefault(initialScope === "this_week"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Last week")
          .setValue("last_week")
          .setDefault(initialScope === "last_week"),
        new StringSelectMenuOptionBuilder()
          .setLabel("All time")
          .setValue("all_time")
          .setDefault(initialScope === "all_time"),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const embed = await buildEmbed(initialScope);
    const reply = await interaction.editReply({
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: [] },
    });

    const collector = reply.createMessageComponentCollector({
      time: 5 * 60_000,
    });

    collector.on("collect", async (event) => {
      if (!event.isStringSelectMenu()) return;
      const i = event as StringSelectMenuInteraction;
      const scope = (i.values[0] as StatScope) ?? initialScope;
      const updated = await buildEmbed(scope);
      const updatedSelect = StringSelectMenuBuilder.from(select).setOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("This week")
          .setValue("this_week")
          .setDefault(scope === "this_week"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Last week")
          .setValue("last_week")
          .setDefault(scope === "last_week"),
        new StringSelectMenuOptionBuilder()
          .setLabel("All time")
          .setValue("all_time")
          .setDefault(scope === "all_time"),
      );
      await i.update({
        embeds: [updated],
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(updatedSelect),
        ],
      });
    });

    collector.on("end", async () => {
      try {
        await reply.edit({ components: [] });
      } catch {
        // Ignore — message may have been deleted.
      }
    });
  },
};

export default command;