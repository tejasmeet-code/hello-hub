import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("vcdeafen")
    .setDescription("Server-deafen or undeafen a member in voice chat.")
    .addUserOption(o => o.setName("user").setDescription("Member to deafen/undeafen").setRequired(true))
    .addBooleanOption(o => o.setName("deafen").setDescription("True = deafen, False = undeafen").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(256))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "vcdeafen"))) return;
    if (!interaction.guild) return;

    const target = interaction.options.getUser("user", true);
    const deafen = interaction.options.getBoolean("deafen", true);
    const reason = interaction.options.getString("reason") ?? `${deafen ? "Deafened" : "Undeafened"} by ${interaction.user.tag}`;

    // Defer before async API calls to avoid the 3-second Discord timeout
    await interaction.deferReply({ flags: 1 << 6 });

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
      await member.voice.setDeaf(deafen, reason);
    } catch {
      await interaction.editReply({ embeds: [errorEmbed("Failed", "Could not deafen/undeafen — check my permissions.")] });
      return;
    }

    await interaction.editReply({
      embeds: [prettyEmbed({
        title: deafen ? "VC Deafened" : "VC Undeafened",
        description: `${CE.success.str}\n\n${buildBullets([
          { label: "User",    value: `<@${target.id}> — ${target.tag}` },
          { label: "Channel", value: `<#${member.voice.channel.id}>` },
          { label: "Reason",  value: reason },
        ])}`,
        thumbnail: target.displayAvatarURL({ size: 256 }),
        color: deafen ? COLORS.warning : COLORS.success,
      })],
    });
  },
};

export default command;