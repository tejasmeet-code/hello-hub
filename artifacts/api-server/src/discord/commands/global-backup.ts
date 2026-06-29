import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { getBackupById, restoreBackup } from "../storage/serverBackup";
import { prettyEmbed, COLORS, CE } from "../utils/embedStyle";
import { logger } from "../../lib/logger";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("global-backup")
    .setDescription("Access server backups from any server by ID (global whitelist only).")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("Show details of a backup by its global ID.")
        .addStringOption((o) =>
          o.setName("id").setDescription("8-character backup ID").setRequired(true).setMinLength(8).setMaxLength(8),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("restore")
        .setDescription("Restore a backup to the current server by its global ID.")
        .addStringOption((o) =>
          o.setName("id").setDescription("8-character backup ID").setRequired(true).setMinLength(8).setMaxLength(8),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "This command is only available to global whitelist users.",
        flags: 1 << 6,
      });
      return;
    }

    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", flags: 1 << 6 });
      return;
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === "info") {
      await interaction.deferReply();
      const id = interaction.options.getString("id", true).toUpperCase();
      const backup = await getBackupById(id);
      if (!backup) {
        await interaction.editReply({ content: `No backup with ID \`${id}\` found.` });
        return;
      }

      const roleNames = backup.roles.slice(0, 20).map((r) => r.name).join(", ");
      const channelNames = backup.channels.slice(0, 15).map((c) => c.name).join(", ");
      const triggerLabel = backup.trigger === "join" ? "Auto (bot joined)" : backup.trigger === "periodic" ? "Auto (periodic)" : "Manual";

      const embed = new EmbedBuilder()
        .setTitle(`Backup ${backup.id} — ${backup.guildName}`)
        .setColor(COLORS.success)
        .addFields(
          { name: "Server", value: backup.guildName, inline: true },
          { name: "Taken", value: `<t:${Math.floor(backup.takenAt / 1000)}:F>`, inline: true },
          { name: "Trigger", value: triggerLabel, inline: true },
          { name: "Roles", value: `${backup.roles.length} roles\n${roleNames || "—"}${backup.roles.length > 20 ? " …" : ""}`, inline: false },
          { name: "Channels", value: `${backup.channels.length} channels\n${channelNames || "—"}${backup.channels.length > 15 ? " …" : ""}`, inline: false },
          { name: "Settings", value: `Verification level: ${backup.settings.verificationLevel}\nExplicit content filter: ${backup.settings.explicitContentFilter}`, inline: false },
        )
        .setFooter({ text: `Use /global-backup restore id:${backup.id} to restore this to the current server` });

      if (backup.guildIcon) embed.setThumbnail(backup.guildIcon);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === "restore") {
      await interaction.deferReply();
      const id = interaction.options.getString("id", true).toUpperCase();
      const backup = await getBackupById(id);
      if (!backup) {
        await interaction.editReply({ content: `No backup with ID \`${id}\` found.` });
        return;
      }

      try {
        const result = await restoreBackup(interaction.guild, backup);
        const errSnippet = result.errors.slice(0, 5).map((e) => `• ${e}`).join("\n");
        await interaction.editReply({
          embeds: [prettyEmbed({
            title: `${result.errors.length === 0 ? CE.success.str : CE.warning.str} Restore Complete — Backup ${id}`,
            description:
              `Restored backup from **${backup.guildName}** taken <t:${Math.floor(backup.takenAt / 1000)}:R>.\n\n` +
              `Roles re-created: **${result.rolesCreated}**\n` +
              `Channels re-created: **${result.channelsCreated}**` +
              (result.errors.length > 0
                ? `\n\n**${result.errors.length} error(s):**\n${errSnippet}${result.errors.length > 5 ? "\n…and more" : ""}`
                : "\n\nNo errors."),
            color: result.errors.length === 0 ? COLORS.success : COLORS.warning,
            footer: "Existing roles and channels were not deleted. Only missing ones were re-created.",
          })],
        });
      } catch (err) {
        logger.error({ err, guildId: interaction.guildId }, "global-backup restore failed");
        await interaction.editReply({ content: "Restore failed. Make sure the bot has the required permissions (Manage Roles, Manage Channels)." });
      }
      return;
    }
  },
};

export default command;