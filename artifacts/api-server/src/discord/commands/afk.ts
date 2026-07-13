import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { setAFK } from "../storage/afk";
import { CE } from "../utils/embedStyle";

const pendingReasons = new Map<string, string>();

export const afkCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Set your AFK status with an optional reason.")
    .addStringOption((o) =>
      o
        .setName("reason")
        .setDescription("Reason for going AFK")
        .setRequired(false),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const reason = interaction.options.getString("reason") ?? "AFK";
    pendingReasons.set(interaction.user.id, reason);

    const embed = new EmbedBuilder()
      .setTitle(`${CE.settings.str} Choose AFK Scope`)
      .setDescription(
        `Should your AFK status apply **Globally** across all servers or **Server-Only** in this server?\n\n**Reason:** ${reason}`,
      )
      .setColor(0x2b2d31);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("afk:scope:global")
        .setLabel("Global AFK")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🌐"),
      new ButtonBuilder()
        .setCustomId("afk:scope:server")
        .setLabel("Server-Only AFK")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🏠"),
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};

export async function handleAfkButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.customId.startsWith("afk:scope:")) return;
  const reason = pendingReasons.get(interaction.user.id) ?? "AFK";
  const scope = interaction.customId === "afk:scope:global" ? "global" : "server";
  const guildId = interaction.guildId ?? undefined;

  await setAFK(interaction.user.id, reason, scope, guildId);
  pendingReasons.delete(interaction.user.id);

  const scopeLabel = scope === "global" ? "Globally" : "Server-Only";
  const embed = new EmbedBuilder()
    .setTitle(`${CE.success.str} AFK Enabled (${scopeLabel})`)
    .setDescription(`You are now marked as AFK ${scopeLabel}.\n\n**Reason:** ${reason}`)
    .setColor(0x57f287);

  await interaction.update({ embeds: [embed], components: [] });
}

export default afkCommand;
