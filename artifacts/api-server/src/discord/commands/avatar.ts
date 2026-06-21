import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a user's avatar.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to show (defaults to you)")
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const url = target.displayAvatarURL({ size: 1024 });
    const embed = new EmbedBuilder()
      .setTitle(`${target.username}'s avatar`)
      .setColor(0xfee75c)
      .setImage(url)
      .setURL(url);
    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
