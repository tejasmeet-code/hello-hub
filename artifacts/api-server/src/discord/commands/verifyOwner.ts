import {
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { exemptRoleFromAutoMod, pushRoleToTop } from "../utils/elevateRole";
import { markServerAsVerified } from "../storage/verified-servers";
import { PERM_WHITELIST } from "../storage/whitelist";
import { CE, COLORS, prettyEmbed } from "../utils/embedStyle";
import { logger } from "../../lib/logger";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("verify-owner")
    .setDescription(
      "Server owner only: create a verified role for the bot and hide channels from @everyone.",
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
      return;
    }

    if (interaction.guild.ownerId !== interaction.user.id && !PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "Only the server owner or Bot Admins can use this command.",
        ephemeral: true,
      });
      return;
    }

    // Step 1 — confirmation prompt
    await interaction.reply({
      embeds: [prettyEmbed({
        title: `${CE.settings.str} Verify Owner`,
        description:
          "This will:\n" +
          "• Create a **🔐 Verified** role with all permissions\n" +
          "• Assign it to me\n" +
          "• Hide all channels from @everyone and grant access only to that role\n" +
          "• Mark this server as verified\n\n" +
          "This action **cannot be automatically undone**. Continue?",
        color: COLORS.warning,
      })],
      ephemeral: true,
      components: [
        {
          type: 1,
          components: [
            { type: 2, label: "Confirm", style: 3, custom_id: "vo_confirm" },
            { type: 2, label: "Cancel",  style: 4, custom_id: "vo_cancel" },
          ],
        },
      ],
    });

    const filter = (i: any) =>
      i.user.id === interaction.user.id &&
      (i.customId === "vo_confirm" || i.customId === "vo_cancel");

    const btn = await interaction.channel
      ?.awaitMessageComponent({ filter, time: 60_000 })
      .catch(() => null);

    if (!btn) {
      await interaction.editReply({ embeds: [prettyEmbed({ title: "Timed out", description: "Verification cancelled.", color: COLORS.danger })], components: [] });
      return;
    }

    if (btn.customId === "vo_cancel") {
      await btn.update({ embeds: [prettyEmbed({ title: `${CE.error.str} Cancelled`, description: "No changes were made.", color: COLORS.danger })], components: [] });
      return;
    }

    await btn.deferUpdate();

    const guild = interaction.guild;
    const me = await guild.members.fetchMe().catch(() => null);
    if (!me) {
      await interaction.editReply({ embeds: [prettyEmbed({ title: `${CE.error.str} Error`, description: "Could not find my own member entry.", color: COLORS.danger })], components: [] });
      return;
    }

    // Step 2 — create role
    let verifyRole;
    try {
      verifyRole = await guild.roles.create({
        name: "🔐 Verified",
        permissions: new PermissionsBitField(PermissionsBitField.All),
        hoist: true,
        color: 0x00ff00,
        reason: "verify-owner: bot verification role",
      });
    } catch (err) {
      logger.error({ err, guildId: guild.id }, "verify-owner: role creation failed");
      await interaction.editReply({
        embeds: [prettyEmbed({ title: `${CE.error.str} Role Creation Failed`, description: "I need **Manage Roles** permission.", color: COLORS.danger })],
        components: [],
      });
      return;
    }

    // Step 3 — push to top, assign to bot
    await pushRoleToTop(guild, verifyRole).catch(() => {});

    try {
      await me.roles.add(verifyRole, "verify-owner: assign to self");
    } catch (err) {
      logger.error({ err, guildId: guild.id }, "verify-owner: role assignment failed");
      await interaction.editReply({
        embeds: [prettyEmbed({ title: `${CE.error.str} Assignment Failed`, description: "Created the role but couldn't assign it to me.", color: COLORS.danger })],
        components: [],
      });
      return;
    }

    // Step 4 — exempt from AutoMod
    await exemptRoleFromAutoMod(guild, verifyRole.id).catch(() => {});

    // Step 5 — hide all channels from @everyone, allow role
    let hiddenCount = 0;
    try {
      const channels = await guild.channels.fetch().catch(() => null);
      if (channels) {
        for (const c of channels.values()) {
          if (!c) continue;
          if (c.type === ChannelType.GuildCategory || c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildAnnouncement) {
            try {
              await c.permissionOverwrites.edit(guild.id, { ViewChannel: false });
              await c.permissionOverwrites.edit(verifyRole.id, { ViewChannel: true });
              hiddenCount++;
            } catch { /* skip individual channel errors */ }
          }
        }
      }
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, "verify-owner: some channel overrides failed");
    }

    // Step 6 — mark verified
    await markServerAsVerified(guild.id).catch(() => {});

    await interaction.editReply({
      embeds: [prettyEmbed({
        title: `${CE.success.str} Server Verified`,
        description:
          `The **🔐 Verified** role has been created and assigned to me.\n\n` +
          `${hiddenCount} channel${hiddenCount === 1 ? "" : "s"} hidden from @everyone — only **🔐 Verified** can view them.\n\n` +
          `Members can now run \`/verify\` to self-verify and gain access.`,
        color: COLORS.success,
      })],
      components: [],
    });

    logger.info({ guildId: guild.id, hiddenCount }, "verify-owner: server verified successfully");
  },
};

export default command;
