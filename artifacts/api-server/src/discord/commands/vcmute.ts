import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed, modActionEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("vcmute")
    .setDescription("Server-mute or unmute a member in voice chat.")
    .addUserOption(o => o.setName("user").setDescription("Member to mute/unmute").setRequired(true))
    .addBooleanOption(o => o.setName("mute").setDescription("True = mute, False = unmute").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(256))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "vcmute"))) return;
    if (!interaction.guild) return;

    const target = interaction.options.getUser("user", true);
    const mute = interaction.options.getBoolean("mute", true);
    const reason = interaction.options.getString("reason") ?? `${mute ? "Muted" : "Unmuted"} by ${interaction.user.tag}`;

    // Defer before async API calls to avoid the 3-second Discord timeout
    await interaction.deferReply();

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ embeds: [errorEmbed("Not in server", "That user is not in this server.")] });
      return;
    }
    if (!member.voice.channel) {
      await interaction.editReply({ embeds: [errorEmbed("Not in voice", `**${target.tag}** is not in a voice channel.`)] });
      return;
    }

    try {
      await member.voice.setMute(mute, reason);
    } catch {
      await interaction.editReply({ embeds: [errorEmbed("Failed", "Could not mute/unmute that user — check my permissions.")] });
      return;
    }

    await interaction.editReply({
      embeds: [modActionEmbed({
        action: mute ? "VC Mute" : "VC Unmute",
        target,
        moderator: interaction.user,
        reason,
        extraFields: [
          { label: "Channel", value: `<#${member.voice.channel.id}>` }
        ],
        emoji: mute ? CE.mute?.str || "🔇" : CE.success.str,
        color: mute ? COLORS.warning : COLORS.success
      })]
    });
  },
};

export default command;