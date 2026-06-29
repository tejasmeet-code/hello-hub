import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { updateProfile } from "../storage/staff";
import { successEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("intro")
    .setDescription("Set your staff directory introduction.")
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName("text")
        .setDescription("Your introduction (max 500 chars). Leave blank to clear.")
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) return;

    const text = interaction.options.getString("text");
    
    if (text && text.length > 500) {
      await interaction.reply({
        content: "Your introduction must be 500 characters or less.",
        ephemeral: true,
      });
      return;
    }

    await updateProfile(interaction.guildId, interaction.user.id, (p) => {
      p.introduction = text || undefined;
      return p;
    });

    if (text) {
      await interaction.reply({
        embeds: [successEmbed("Introduction Updated", "Your staff introduction has been saved and will appear in the Staff Directory portal.")],
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        embeds: [successEmbed("Introduction Cleared", "Your staff introduction has been cleared.")],
        ephemeral: true,
      });
    }
  },
};

export default command;
