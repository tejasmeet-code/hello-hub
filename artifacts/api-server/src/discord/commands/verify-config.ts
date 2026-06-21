import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Role,
  type TextChannel,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getServerConfig, updateServerConfig } from "../storage/verification-config";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("verify-config")
    .setDescription("Configure verification settings for this server (owner only)")
    .addRoleOption((option) =>
      option
        .setName("role")
        .setDescription("Role to assign to pulled members")
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("use-modal")
        .setDescription("Use modal with button instead of direct confirmation")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("custom-message")
        .setDescription("Custom message for verification (leave empty to reset)")
        .setRequired(false),
    )
    .addChannelOption((option) =>
      option
        .setName("verify-channel")
        .setDescription("Channel where verification prompt will be posted")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
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
        content: "Only the server owner can use this command.",
        ephemeral: true,
      });
      return;
    }

    const role = interaction.options.getRole("role");
    const useModal = interaction.options.getBoolean("use-modal");
    const customMessage = interaction.options.getString("custom-message");
    const verifyChannel = interaction.options.getChannel("verify-channel") as TextChannel | null;

    const currentConfig = await getServerConfig(interaction.guildId);
    const updates: any = {};

    if (role) {
      // Add role to the list if not already there
      const rolesToAssign = currentConfig.rolesToAssign || [];
      if (!rolesToAssign.includes(role.id)) {
        updates.rolesToAssign = [...rolesToAssign, role.id];
      }
    }

    if (useModal !== null) {
      updates.useModal = useModal;
    }

    if (customMessage !== null) {
      updates.customMessage = customMessage || undefined;
    }

    if (verifyChannel) {
      updates.verifyChannelId = verifyChannel.id;
    }

    if (Object.keys(updates).length === 0) {
      // Show current config
      const rolesText = currentConfig.rolesToAssign?.length
        ? currentConfig.rolesToAssign.map(id => `<@&${id}>`).join(", ")
        : "None";
      
      const channelText = currentConfig.verifyChannelId 
        ? `<#${currentConfig.verifyChannelId}>`
        : "Not set (users must use /verify)";

      await interaction.reply({
        content: `${CE.information.str} **Current Verification Config:**\n` +
          `• **Use Modal:** ${currentConfig.useModal ? "Yes" : "No"}\n` +
          `• **Roles to Assign:** ${rolesText}\n` +
          `• **Verify Channel:** ${channelText}\n` +
          `• **Custom Message:** ${currentConfig.customMessage || "Default"}`,
        ephemeral: true,
      });
      return;
    }

    await updateServerConfig(interaction.guildId, updates);

    let response = `${CE.success.str} Verification config updated:\n`;

    if (updates.rolesToAssign) {
      response += `• Added role: <@&${role!.id}>\n`;
    }

    if (updates.useModal !== undefined) {
      response += `• Use modal: ${updates.useModal ? "Enabled" : "Disabled"}\n`;
    }

    if (updates.customMessage !== undefined) {
      response += `• Custom message: ${updates.customMessage ? `"${updates.customMessage}"` : "Reset to default"}\n`;
    }

    if (updates.verifyChannelId) {
      response += `• Verify channel: <#${updates.verifyChannelId}>\n`;
      
      // Post verification prompt to the channel
      try {
        const channel = await interaction.guild!.channels.fetch(updates.verifyChannelId) as TextChannel;
        const promptMessage = updates.customMessage || "**Verify yourself to access the server!**\n\nClick the button below to start verification.";
        
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("verify_prompt")
            .setLabel("Verify Now")
            .setStyle(ButtonStyle.Success),
        );

        await channel.send({
          content: promptMessage,
          components: [row],
        });
      } catch (err) {
        response += `${CE.warning.str} Could not post verification prompt to channel\n`;
      }
    }

    await interaction.reply({
      content: response,
      ephemeral: true,
    });
  },
};

export default command;