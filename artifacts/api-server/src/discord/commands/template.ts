/**
 * /template — Dev-only server config template management.
 * Save, list, view, apply, and delete named snapshots of a guild's
 * transferable settings (modules + per-module config, no channels/roles).
 * Only global perm-whitelist (dev) users can run any subcommand.
 */
import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { getGuildConfig, updateGuildConfig } from "../storage/config";
import {
  saveTemplate,
  listTemplates,
  getTemplate,
  findTemplateByName,
  deleteTemplate,
  type TransferableConfig,
} from "../storage/templates";
import { COLORS, prettyEmbed , CE } from "../utils/embedStyle";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDev(userId: string): boolean {
  return PERM_WHITELIST.has(userId);
}

/** Pull only the transferable parts out of a full GuildConfig. */
async function extractTransferable(guildId: string): Promise<TransferableConfig> {
  const cfg = await getGuildConfig(guildId);
  const t: TransferableConfig = { modules: { ...cfg.modules } };
  if (cfg.guildPrefix !== undefined) t.guildPrefix = cfg.guildPrefix;
  if (cfg.quotaConfig) t.quotaConfig = { ...cfg.quotaConfig };
  if (cfg.infractionsConfig) t.infractionsConfig = { ...cfg.infractionsConfig };
  if (cfg.moderationConfig) t.moderationConfig = { ...cfg.moderationConfig };
  if (cfg.promotionsConfig) t.promotionsConfig = { ...cfg.promotionsConfig };
  if (cfg.demotionsConfig) t.demotionsConfig = { ...cfg.demotionsConfig };
  if (cfg.appealsConfig) t.appealsConfig = { ...cfg.appealsConfig };
  if (cfg.loaConfig) t.loaConfig = { ...cfg.loaConfig };
  if (cfg.staffReportConfig) t.staffReportConfig = { ...cfg.staffReportConfig };
  if (cfg.quotaFailureConfig) t.quotaFailureConfig = { ...cfg.quotaFailureConfig };
  if (cfg.partnershipConfig) t.partnershipConfig = { ...cfg.partnershipConfig };
  if (cfg.antiNukeConfig) t.antiNukeConfig = { ...cfg.antiNukeConfig } as any;
  return t;
}

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
    .setName("template")
    .setDescription("[Dev] Manage server config templates.")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("save")
        .setDescription("Save this server's current config as a named template.")
        .addStringOption((o) =>
          o.setName("name").setDescription("Template name (unique).").setRequired(true).setMaxLength(40),
        )
        .addStringOption((o) =>
          o.setName("description").setDescription("Short description.").setRequired(false).setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("List all saved templates."),
    )
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("View the details of a template.")
        .addStringOption((o) =>
          o.setName("name").setDescription("Template name or ID.").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("apply")
        .setDescription("Apply a template to this server (replaces modules + module settings, keeps channels/roles).")
        .addStringOption((o) =>
          o.setName("name").setDescription("Template name or ID.").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("Permanently delete a template.")
        .addStringOption((o) =>
          o.setName("name").setDescription("Template name or ID.").setRequired(true),
        ),
    ) as any,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isDev(interaction.user.id)) {
      await interaction.reply({ content: `${CE.error.str} Templates are restricted to bot developers.`, flags: 1 << 6 });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId ?? "DM";

    // ── save ──────────────────────────────────────────────────────────────────
    if (sub === "save") {
      if (!interaction.guildId) {
        await interaction.reply({ content: "Run this inside a server.", flags: 1 << 6 });
        return;
      }
      const name = interaction.options.getString("name", true).trim();
      const description = interaction.options.getString("description") ?? "No description.";

      const existing = await findTemplateByName(name);
      if (existing) {
        await interaction.reply({
          content: `${CE.error.str} A template named **${name}** already exists (\`${existing.id}\`). Delete it first or choose a different name.`,
          flags: 1 << 6,
        });
        return;
      }

      await interaction.deferReply();
      const config = await extractTransferable(interaction.guildId);
      const tpl = await saveTemplate({
        name,
        description,
        createdBy: interaction.user.id,
        createdAt: Date.now(),
        sourceGuildId: interaction.guildId,
        config,
      });

      const embed = new EmbedBuilder()
        .setTitle(`${CE.success.str} Template Saved`)
        .setColor(COLORS.success)
        .addFields(
          { name: "Name", value: tpl.name, inline: true },
          { name: "ID", value: `\`${tpl.id}\``, inline: true },
          { name: "Source Guild", value: `\`${tpl.sourceGuildId}\``, inline: true },
          { name: "Modules", value: modulesField(config.modules), inline: false },
        )
        .setFooter({ text: description })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === "list") {
      const templates = await listTemplates();
      if (templates.length === 0) {
        await interaction.reply({ content: "No templates saved yet. Use `/template save` in any server.", flags: 1 << 6 });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(`${CE.information.str} Config Templates (${templates.length})`)
        .setColor(COLORS.primary)
        .setDescription(
          templates
            .map(
              (t) =>
                `**${t.name}** — \`${t.id}\`\n` +
                `${t.description}\n` +
                `_Saved from \`${t.sourceGuildId}\` by <@${t.createdBy}> <t:${Math.floor(t.createdAt / 1000)}:R>_`,
            )
            .join("\n\n"),
        )
        .setFooter({ text: "Use /template view <name> for module details." });

      await interaction.reply({ embeds: [embed], flags: 1 << 6 });
      return;
    }

    // ── view ──────────────────────────────────────────────────────────────────
    if (sub === "view") {
      const nameOrId = interaction.options.getString("name", true).trim();
      const tpl = (await findTemplateByName(nameOrId)) ?? (await getTemplate(nameOrId));
      if (!tpl) {
        await interaction.reply({ content: `${CE.error.str} No template found for \`${nameOrId}\`.`, flags: 1 << 6 });
        return;
      }

      const c = tpl.config;
      const fields: { name: string; value: string; inline: boolean }[] = [
        { name: "ID", value: `\`${tpl.id}\``, inline: true },
        { name: "Source Guild", value: `\`${tpl.sourceGuildId}\``, inline: true },
        { name: "Created", value: `<t:${Math.floor(tpl.createdAt / 1000)}:R> by <@${tpl.createdBy}>`, inline: true },
        { name: "Modules", value: modulesField(c.modules), inline: false },
      ];
      if (c.quotaConfig) {
        fields.push({ name: "Quota", value: `${c.quotaConfig.messages} msgs / ${c.quotaConfig.modActions} mod actions per week`, inline: true });
      }
      if (c.infractionsConfig) {
        fields.push({
          name: "Infractions",
          value: [
            `Strike expiry: ${c.infractionsConfig.strikeExpiryDays}d`,
            `Auto-demote: ${c.infractionsConfig.autoDemotionEnabled ? "yes" : "no"}`,
            `DM on infraction: ${c.infractionsConfig.dmOnInfraction ? "yes" : "no"}`,
            `Actions: ${c.infractionsConfig.strikeAction1} / ${c.infractionsConfig.strikeAction2} / ${c.infractionsConfig.strikeAction3plus}`,
          ].join("\n"),
          inline: true,
        });
      }
      if (c.quotaFailureConfig) {
        fields.push({
          name: "Quota Failures",
          value: `1st: ${c.quotaFailureConfig.failure1}\n2nd: ${c.quotaFailureConfig.failure2}\n3rd+: ${c.quotaFailureConfig.failure3plus}`,
          inline: true,
        });
      }
      if (c.loaConfig) {
        fields.push({ name: "LOA", value: `Max ${c.loaConfig.maxDurationDays || "∞"}d, reason ${c.loaConfig.requireReason ? "required" : "optional"}`, inline: true });
      }
      if (c.appealsConfig) {
        fields.push({ name: "Appeals", value: `Auto-close: ${c.appealsConfig.autoCloseDays || "disabled"}`, inline: true });
      }

      const embed = new EmbedBuilder()
        .setTitle(`${CE.rps_paper.str} Template: ${tpl.name}`)
        .setColor(COLORS.info)
        .setDescription(tpl.description)
        .addFields(fields)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: 1 << 6 });
      return;
    }

    // ── apply ─────────────────────────────────────────────────────────────────
    if (sub === "apply") {
      if (!interaction.guildId) {
        await interaction.reply({ content: "Run this inside a server.", flags: 1 << 6 });
        return;
      }
      const nameOrId = interaction.options.getString("name", true).trim();
      const tpl = (await findTemplateByName(nameOrId)) ?? (await getTemplate(nameOrId));
      if (!tpl) {
        await interaction.reply({ content: `${CE.error.str} No template found for \`${nameOrId}\`.`, flags: 1 << 6 });
        return;
      }

      await interaction.deferReply();
      await applyTransferable(interaction.guildId, tpl.config);

      const embed = new EmbedBuilder()
        .setTitle(`${CE.success.str} Template Applied: ${tpl.name}`)
        .setColor(COLORS.success)
        .setDescription(
          `Modules and per-module settings from **${tpl.name}** have been applied to this server.\n\n` +
          `${CE.warning.str} **Channels and roles were not changed** — update them via \`/config channel\` and \`/staff-role-add\`.`,
        )
        .addFields({ name: "Modules now active", value: modulesField(tpl.config.modules), inline: false })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── delete ────────────────────────────────────────────────────────────────
    if (sub === "delete") {
      const nameOrId = interaction.options.getString("name", true).trim();
      const tpl = (await findTemplateByName(nameOrId)) ?? (await getTemplate(nameOrId));
      if (!tpl) {
        await interaction.reply({ content: `${CE.error.str} No template found for \`${nameOrId}\`.`, flags: 1 << 6 });
        return;
      }
      await deleteTemplate(tpl.id);
      await interaction.reply({ content: `🗑️ Template **${tpl.name}** (\`${tpl.id}\`) deleted.`, flags: 1 << 6 });
      return;
    }
  },
};

export default command;
