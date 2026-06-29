import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { isAdminOrOwner } from "../utils/staffPerms";
import { errorEmbed } from "../utils/embedStyle";
import { buildPortalMessage } from "../handlers/portalHandler";
import { getGuildConfig } from "../storage/config";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("portal")
    .setDescription("Spawn the Staff Directory & Feedback Portal.")
    .setDMPermission(false),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;

    if (!(await isAdminOrOwner(interaction.guild.id, interaction.user.id))) {
      await interaction.reply({
        embeds: [errorEmbed("Permission Denied", "Only administrators can spawn the staff portal.")],
        ephemeral: true,
      });
      return;
    }

    const config = await getGuildConfig(interaction.guild.id);
    if (!config.modules?.staffDirectory) {
      await interaction.reply({
        embeds: [errorEmbed("Module Disabled", "The Staff Directory module is currently disabled. Enable it in `/config`.")],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const msg = await buildPortalMessage(interaction.guild, 0);
    await interaction.channel?.send(msg);

    await interaction.editReply({ content: "Staff portal spawned successfully!" });
  },
};

export default command;
