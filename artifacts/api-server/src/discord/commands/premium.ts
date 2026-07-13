import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { isBotAdmin, createPremiumCode, redeemPremiumCode } from "../storage/premium";
import { CE } from "../utils/embedStyle";

const SUPPORT_SERVER_URL = "https://discord.gg/gFgAfpSYdp";

export const premiumUserCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("premium-user")
    .setDescription("Activate User-Based Premium using a license code.")
    .addStringOption((o) =>
      o
        .setName("code")
        .setDescription("Your premium license activation code")
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const code = interaction.options.getString("code", true);
    const result = await redeemPremiumCode(code, interaction.user.id, "user");

    if (!result.success) {
      const embed = new EmbedBuilder()
        .setTitle(`${CE.failure.str} Premium Activation Failed`)
        .setDescription(
          `${result.message}\n\nTo purchase a valid Premium License Code, please **join our Official Support Server and open a support ticket**: ${SUPPORT_SERVER_URL}`,
        )
        .setColor(0xed4245);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${CE.success.str} User Premium Activated!`)
      .setDescription(result.message)
      .setColor(0x57f287);
    await interaction.reply({ embeds: [embed] });
  },
};

export const premiumServerCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("premium-server")
    .setDescription("Activate Guild-Based Premium using a license code.")
    .addStringOption((o) =>
      o
        .setName("code")
        .setDescription("Your guild premium license activation code")
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }
    const code = interaction.options.getString("code", true);
    const result = await redeemPremiumCode(code, interaction.guildId, "server");

    if (!result.success) {
      const embed = new EmbedBuilder()
        .setTitle(`${CE.failure.str} Premium Activation Failed`)
        .setDescription(
          `${result.message}\n\nTo purchase a valid Premium License Code, please **join our Official Support Server and open a support ticket**: ${SUPPORT_SERVER_URL}`,
        )
        .setColor(0xed4245);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${CE.success.str} Server Premium Activated!`)
      .setDescription(result.message)
      .setColor(0x57f287);
    await interaction.reply({ embeds: [embed] });
  },
};

export const premiumGenerateCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("premium-generate")
    .setDescription("Bot Admin only: Generate a time-bounded premium license activation code.")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Code type")
        .setRequired(true)
        .addChoices(
          { name: "User-Based", value: "user" },
          { name: "Guild-Based", value: "server" },
        ),
    )
    .addIntegerOption((o) =>
      o
        .setName("days")
        .setDescription("Duration in days")
        .setRequired(true)
        .setMinValue(1),
    )
    .addIntegerOption((o) =>
      o
        .setName("limit")
        .setDescription("Multi-guild limit quota (default 1)")
        .setRequired(false)
        .setMinValue(1),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isBotAdmin(interaction.user.id)) {
      await interaction.reply({
        content: "Only authorized Bot Admins can generate premium activation codes.",
        ephemeral: true,
      });
      return;
    }

    const type = interaction.options.getString("type", true) as "user" | "server";
    const days = interaction.options.getInteger("days", true);
    const limit = interaction.options.getInteger("limit") ?? 1;

    const randomString = Math.random().toString(36).substring(2, 8).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const codeStr = `PREM-${type.toUpperCase()}-${randomString}`;

    const code = await createPremiumCode(codeStr, type, days, limit);

    const embed = new EmbedBuilder()
      .setTitle(`${CE.success.str} Premium License Code Generated`)
      .setDescription(`Generated a new **${type.toUpperCase()}** premium code valid for **${days} days**.`)
      .addFields(
        { name: "Activation Code", value: `\`${code.code}\``, inline: false },
        { name: "Redemption Quota", value: `${code.guildLimit} activation(s)`, inline: true },
      )
      .setColor(0xF1C40F);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
