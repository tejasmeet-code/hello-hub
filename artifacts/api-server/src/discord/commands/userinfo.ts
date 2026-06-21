import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Show information about a user.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to look up (defaults to you)")
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const member = await interaction.guild?.members.fetch(target.id).catch(() => null);

    const embed = new EmbedBuilder()
      .setTitle(target.tag)
      .setColor(0xeb459e)
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "User ID", value: target.id, inline: true },
        {
          name: "Account Created",
          value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
      );

    if (member?.joinedTimestamp) {
      embed.addFields({
        name: "Joined Server",
        value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
        inline: true,
      });
    }

    if (member && member.roles.cache.size > 1) {
      const roles = member.roles.cache
        .filter((r) => r.id !== interaction.guild?.id)
        .map((r) => `<@&${r.id}>`)
        .slice(0, 10)
        .join(" ");
      embed.addFields({ name: "Roles", value: roles || "None" });
    }

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
