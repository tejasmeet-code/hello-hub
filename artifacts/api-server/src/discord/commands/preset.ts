/**
 * /preset — Apply a built-in config preset to this server.
 * Presets are hardcoded by devs; any server manager can apply one.
 * Applying a preset replaces modules + per-module settings but leaves
 * channels, managers, and role lists untouched.
 */
import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { isManager } from "../utils/staffPerms";
import { updateGuildConfig } from "../storage/config";
import { listPresets, getPreset } from "../storage/presets";
import type { TransferableConfig } from "../storage/templates";
import { COLORS , CE } from "../utils/embedStyle";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Apply a TransferableConfig onto a guild, preserving channels/managers/roles. */
async function applyTransferable(guildId: string, t: TransferableConfig): Promise<void> {
  await updateGuildConfig(guildId, (cfg) => ({
    ...cfg,
    modules: { ...cfg.modules, ...t.modules },
    guildPrefix:         t.guildPrefix         ?? cfg.guildPrefix,
    quotaConfig:         t.quotaConfig          ?? cfg.quotaConfig,
    infractionsConfig:   t.infractionsConfig    ?? cfg.infractionsConfig,
    moderationConfig:    t.moderationConfig     ?? cfg.moderationConfig,
    promotionsConfig:    t.promotionsConfig     ?? cfg.promotionsConfig,
    demotionsConfig:     t.demotionsConfig      ?? cfg.demotionsConfig,
    appealsConfig:       t.appealsConfig        ?? cfg.appealsConfig,
    loaConfig:           t.loaConfig            ?? cfg.loaConfig,
    staffReportConfig:   t.staffReportConfig    ?? cfg.staffReportConfig,
    quotaFailureConfig:  t.quotaFailureConfig   ?? cfg.quotaFailureConfig,
    partnershipConfig:   t.partnershipConfig    ?? cfg.partnershipConfig,
    antiNukeConfig:      t.antiNukeConfig       ?? cfg.antiNukeConfig,
  }));
}

function modulesField(modules: TransferableConfig["modules"]): string {
  const on: string[] = [];
  const off: string[] = [];
  for (const [k, v] of Object.entries(modules)) {
    (v ? on : off).push(k);
  }
  return `${CE.success.str} ${on.join(", ") || "none"}\n${CE.error.str} ${off.join(", ") || "none"}`;
}

// ── Command ───────────────────────────────────────────────────────────────────

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("preset")
    .setDescription("Apply a built-in config preset to this server.")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s.setName("list").setDescription("Browse all available presets."),
    )
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("Preview what a preset configures before applying it.")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Preset ID (e.g. neku, standard, strict, moderation, minimal, partnership).")
            .setRequired(true)
            .addChoices(
              { name: "Neku Standard", value: "neku" },
              { name: "Standard", value: "standard" },
              { name: "Strict Staff", value: "strict" },
              { name: "Moderation Focus", value: "moderation" },
              { name: "Minimal", value: "minimal" },
              { name: "Partnership Server", value: "partnership" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("apply")
        .setDescription("Apply a preset. Modules & settings update; channels & roles stay untouched.")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Which preset to apply.")
            .setRequired(true)
            .addChoices(
              { name: "Neku Standard", value: "neku" },
              { name: "Standard", value: "standard" },
              { name: "Strict Staff", value: "strict" },
              { name: "Moderation Focus", value: "moderation" },
              { name: "Minimal", value: "minimal" },
              { name: "Partnership Server", value: "partnership" },
            ),
        ),
    ) as any,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Run this inside a server.", flags: 1 << 6 });
      return;
    }

    const sub = interaction.options.getSubcommand();

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === "list") {
      const presets = listPresets();
      const embed = new EmbedBuilder()
        .setTitle(`${CE.information.str} Available Presets`)
        .setColor(COLORS.primary)
        .setDescription(
          presets
            .map(
              (p) =>
                `**${p.name}** (\`${p.id}\`)\n${p.description}\n` +
                p.highlights.map((h) => `• ${h}`).join("\n"),
            )
            .join("\n\n"),
        )
        .setFooter({ text: "Use /preset view <name> to see full details, then /preset apply <name> to apply." });

      await interaction.reply({ embeds: [embed], flags: 1 << 6 });
      return;
    }

    // ── view ──────────────────────────────────────────────────────────────────
    if (sub === "view") {
      const id = interaction.options.getString("name", true);
      const preset = getPreset(id);
      if (!preset) {
        await interaction.reply({ content: `${CE.error.str} Unknown preset \`${id}\`.`, flags: 1 << 6 });
        return;
      }

      const c = preset.config;
      const fields: { name: string; value: string; inline: boolean }[] = [
        { name: "Modules", value: modulesField(c.modules), inline: false },
      ];

      if (c.quotaConfig) {
        fields.push({
          name: "Quota",
          value: `${c.quotaConfig.messages} messages **or** ${c.quotaConfig.modActions} mod actions / week`,
          inline: true,
        });
      }
      if (c.infractionsConfig) {
        fields.push({
          name: "Infractions",
          value: [
            `Strike expiry: ${c.infractionsConfig.strikeExpiryDays} days`,
            `Auto-demote at 3 strikes: ${c.infractionsConfig.autoDemotionEnabled ? `${CE.success.str}` : `${CE.error.str}`}`,
            `DM on infraction: ${c.infractionsConfig.dmOnInfraction ? `${CE.success.str}` : `${CE.error.str}`}`,
            `1 strike → ${c.infractionsConfig.strikeAction1}`,
            `2 strikes → ${c.infractionsConfig.strikeAction2}`,
            `3+ strikes → ${c.infractionsConfig.strikeAction3plus}`,
          ].join("\n"),
          inline: true,
        });
      }
      if (c.quotaFailureConfig) {
        fields.push({
          name: "Quota Failures",
          value: [
            `1st miss → ${c.quotaFailureConfig.failure1}`,
            `2nd miss → ${c.quotaFailureConfig.failure2}`,
            `3rd+ miss → ${c.quotaFailureConfig.failure3plus}`,
          ].join("\n"),
          inline: true,
        });
      }
      if (c.loaConfig) {
        fields.push({
          name: "LOA",
          value: `Max ${c.loaConfig.maxDurationDays || "unlimited"} days\nReason ${c.loaConfig.requireReason ? "required" : "optional"}`,
          inline: true,
        });
      }
      if (c.appealsConfig) {
        fields.push({
          name: "Appeals",
          value: `Auto-close after ${c.appealsConfig.autoCloseDays || "never"}`,
          inline: true,
        });
      }
      if (c.partnershipConfig) {
        fields.push({
          name: "Partnership",
          value: `Quota: ${c.partnershipConfig.quota}/week\nMiss 1: ${c.partnershipConfig.failureActions[1]}\nMiss 2: ${c.partnershipConfig.failureActions[2]}\nMiss 3+: ${c.partnershipConfig.failureActions[3]}`,
          inline: true,
        });
      }
      if (c.moderationConfig) {
        fields.push({ name: "Moderation", value: `DM on action: ${c.moderationConfig.dmOnAction ? `${CE.success.str}` : `${CE.error.str}`}`, inline: true });
      }

      fields.push({
        name: `${CE.warning.str} What stays unchanged`,
        value: "Channels, manager roles, staff roles, role quotas, quota whitelist roles, and all other server-specific settings.",
        inline: false,
      });

      const embed = new EmbedBuilder()
        .setTitle(`${CE.information.str} Preset: ${preset.name}`)
        .setColor(COLORS.info)
        .setDescription(preset.description)
        .addFields(fields)
        .setFooter({ text: `Run /preset apply ${preset.id} to apply this preset to your server.` });

      await interaction.reply({ embeds: [embed], flags: 1 << 6 });
      return;
    }

    // ── apply ─────────────────────────────────────────────────────────────────
    if (sub === "apply") {
      if (!(await isManager(interaction))) {
        await interaction.reply({ content: `${CE.error.str} Only server managers can apply presets.`, flags: 1 << 6 });
        return;
      }

      const id = interaction.options.getString("name", true);
      const preset = getPreset(id);
      if (!preset) {
        await interaction.reply({ content: `${CE.error.str} Unknown preset \`${id}\`.`, flags: 1 << 6 });
        return;
      }

      await interaction.deferReply();
      await applyTransferable(interaction.guildId, preset.config);

      const embed = new EmbedBuilder()
        .setTitle(`${CE.success.str} Preset Applied: ${preset.name}`)
        .setColor(COLORS.success)
        .setDescription(
          `**${preset.name}** is now active on this server.\n\n` +
            `**What changed:** modules toggled and per-module settings updated.\n` +
            `**What stayed the same:** channels, managers, staff roles, role quotas.\n\n` +
            `**Next steps:**\n` +
            `• Set channels → \`/config channel\`\n` +
            `• Set managers → \`/config manager\`\n` +
            `• Add staff roles → \`/staff-role-add\`\n` +
            `• Check the full config → \`/config view\``,
        )
        .addFields(
          { name: "Modules now active", value: modulesField(preset.config.modules), inline: false },
        )
        .setFooter({ text: preset.description })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }
  },
};

export default command;
