import {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { isManager } from "../utils/staffPerms";
import {
  takeBackup,
  listBackups,
  getBackup,
  restoreBackup,
} from "../storage/serverBackup";
import { prettyEmbed, COLORS, CE } from "../utils/embedStyle";
import { logger } from "../../lib/logger";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("server-backup")
    .setDescription("Create and manage server structure backups (roles, channels, settings).")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("take")
        .setDescription("Take a manual backup of the server right now."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List all stored backups for this server."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("Show details of a specific backup.")
        .addStringOption((o) =>
          o.setName("id").setDescription("Backup ID (from /server-backup list)").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("restore")
        .setDescription("Restore a backup: re-create missing roles and channels.")
        .addStringOption((o) =>
          o.setName("id").setDescription("Backup ID (from /server-backup list)").setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", flags: 1 << 6 });
      return;
    }

    if (!(await isManager(interaction))) {
      await interaction.reply({ content: "Only server managers can use this command.", flags: 1 << 6 });
      return;
    }

    const sub = interaction.options.getSubcommand(true);

    if (sub === "take") {
      const modal = new ModalBuilder()
        .setCustomId("server_backup_take")
        .setTitle("Create Server Backup")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("save_messages")
              .setLabel("Save recent text messages?")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("yes or no")
              .setMaxLength(3),
          ),
        );
      await interaction.showModal(modal);
      return;
    }

    if (sub === "list") {
      await interaction.deferReply();
      const backups = await listBackups(interaction.guildId);
      if (backups.length === 0) {
        await interaction.editReply({
          embeds: [prettyEmbed({
            title: "No Backups",
            description: "No backups found for this server. Use `/server-backup take` to create one.\n\nBackups are also taken automatically each time the bot joins the server.",
            color: COLORS.neutral,
          })],
        });
        return;
      }

      const lines = backups.map((b) => {
        const triggerLabel = b.trigger === "join" ? "auto-join" : b.trigger === "periodic" ? "auto-periodic" : "manual";
        return `**${b.id}** — <t:${Math.floor(b.takenAt / 1000)}:D> · ${triggerLabel} · ${b.roles.length} roles · ${b.channels.length} channels`;
      });

      await interaction.editReply({
        embeds: [prettyEmbed({
          title: `Server Backups — ${interaction.guild.name}`,
          description: lines.join("\n"),
          color: COLORS.info ?? 0x5865f2,
          footer: "Use /server-backup info id:<ID> for details, or /server-backup restore id:<ID> to restore",
        })],
      });
      return;
    }

    if (sub === "info") {
      await interaction.deferReply();
      const id = interaction.options.getString("id", true);
      const backup = await getBackup(interaction.guildId, id);
      if (!backup) {
        await interaction.editReply({ content: `No backup ${id} found.` });
        return;
      }

      const roleNames = backup.roles.slice(0, 20).map((r) => r.name).join(", ");
      const channelNames = backup.channels.slice(0, 15).map((c) => c.name).join(", ");
      const triggerLabel = backup.trigger === "join" ? "Auto (bot joined)" : backup.trigger === "periodic" ? "Auto (periodic)" : "Manual";

      const embed = new EmbedBuilder()
        .setTitle(`Backup ${backup.id} — ${backup.guildName}`)
        .setColor(COLORS.success)
        .addFields(
          { name: "Taken", value: `<t:${Math.floor(backup.takenAt / 1000)}:F>`, inline: true },
          { name: "Trigger", value: triggerLabel, inline: true },
          { name: "Roles", value: `${backup.roles.length} roles\n${roleNames || "—"}${backup.roles.length > 20 ? " …" : ""}`, inline: false },
          { name: "Channels", value: `${backup.channels.length} channels\n${channelNames || "—"}${backup.channels.length > 15 ? " …" : ""}`, inline: false },
          { name: "Settings", value: `Verification level: ${backup.settings.verificationLevel}\nExplicit content filter: ${backup.settings.explicitContentFilter}`, inline: false },
        )
        .setFooter({ text: `Use /server-backup restore id:${backup.id} to restore this snapshot` });

      if (backup.guildIcon) embed.setThumbnail(backup.guildIcon);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === "restore") {
      await interaction.deferReply();
      const id = interaction.options.getString("id", true);
      const backup = await getBackup(interaction.guildId, id);
      if (!backup) {
        await interaction.editReply({ content: `No backup ${id} found.` });
        return;
      }

      try {
        const result = await restoreBackup(interaction.guild, backup);
        const errSnippet = result.errors.slice(0, 5).map((e) => `• ${e}`).join("\n");

        let botSection = "";
        if (backup.bots && backup.bots.length > 0) {
          const missingBots = backup.bots.filter((b) => !interaction.guild!.members.cache.has(b.userId));
          const alreadyPresent = backup.bots.length - missingBots.length;
          const botList = missingBots
            .map((b) => {
              const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${b.userId}&scope=bot+applications.commands&permissions=8`;
              return `• **${b.botTag}** — [Invite](${inviteUrl})`;
            })
            .join("\n");
          botSection =
            `\n\n**Bots in backup:** ${backup.bots.length}` +
            (alreadyPresent > 0 ? ` (${alreadyPresent} already present)` : "") +
            (botList ? `\n**Bots to re-invite:**\n${botList}` : "\nAll bots are already in the server.");
        }

        await interaction.editReply({
          embeds: [prettyEmbed({
            title: `${result.errors.length === 0 ? CE.success.str : CE.warning.str} Restore Complete — Backup ${id}`,
            description:
              `Restored from snapshot taken <t:${Math.floor(backup.takenAt / 1000)}:R>.\n\n` +
              `Roles re-created: **${result.rolesCreated}**\n` +
              `Channels re-created: **${result.channelsCreated}**\n` +
              `Member roles restored: **${result.memberRolesRestored}**` +
              botSection +
              (result.errors.length > 0
                ? `\n\n**${result.errors.length} error(s):**\n${errSnippet}${result.errors.length > 5 ? "\n…and more" : ""}`
                : "\n\nNo errors."),
            color: result.errors.length === 0 ? COLORS.success : COLORS.warning,
            footer: "Existing roles and channels were not deleted. Only missing ones were re-created.",
          })],
        });
      } catch (err) {
        logger.error({ err, guildId: interaction.guildId }, "server-backup restore failed");
        await interaction.editReply({ content: "Restore failed. Make sure the bot has the required permissions (Manage Roles, Manage Channels)." });
      }
      return;
    }
  },
};

export async function handleServerBackupTakeModalSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: "That modal must be submitted in a server.", ephemeral: true });
    return;
  }

  if (!(await isManager(interaction as any))) {
    await interaction.reply({ content: "Only server managers can take backups.", ephemeral: true });
    return;
  }

  const saveMessagesRaw = interaction.fields.getTextInputValue("save_messages").trim().toLowerCase();
  const includeMessages = /^(y|yes)$/i.test(saveMessagesRaw);

  await interaction.deferReply();
  try {
    const backup = await takeBackup(interaction.guild, "manual", { includeMessages });
    await interaction.editReply({
      embeds: [prettyEmbed({
        title: `${CE.success.str} Backup ${backup.id} Saved`,
        description:
          `A full snapshot of **${interaction.guild.name}** has been saved.\n\n` +
          `Roles captured: **${backup.roles.length}**\n` +
          `Channels captured: **${backup.channels.length}**\n` +
          `Messages saved: **${includeMessages ? "Yes" : "No"}**\n` +
          `Taken at: <t:${Math.floor(backup.takenAt / 1000)}:F>`,
        color: COLORS.success,
        footer: `Use /server-backup restore id:${backup.id} to restore this snapshot`,
      })],
    });
  } catch (err) {
    logger.error({ err, guildId: interaction.guildId }, "server-backup take modal submit failed");
    await interaction.editReply({ content: "Failed to take backup. Check bot permissions." });
  }
}

export default command;