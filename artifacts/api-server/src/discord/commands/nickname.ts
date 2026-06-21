import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("nickname")
    .setDescription("Change or reset a member's nickname.")
    .addUserOption(o => o.setName("user").setDescription("Member to rename").setRequired(true))
    .addStringOption(o => o.setName("nickname").setDescription("New nickname (leave blank to reset)").setRequired(false).setMaxLength(32))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(256))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "nickname"))) return;
    if (!interaction.guild) return;

    const target = interaction.options.getUser("user", true);
    const nickname = interaction.options.getString("nickname") ?? null;
    const reason = interaction.options.getString("reason") ?? `Changed by ${interaction.user.tag}`;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({ embeds: [errorEmbed("Not in server", "That user is not in this server.")] , flags: 1 << 6 });
      return;
    }

    const oldNick = member.nickname ?? member.user.username;
    try {
      await member.setNickname(nickname, reason);
    } catch {
      await interaction.reply({ embeds: [errorEmbed("Failed", "Could not change that nickname — check my permissions.")] , flags: 1 << 6 });
      return;
    }

    await interaction.reply({
      embeds: [prettyEmbed({
        title: nickname ? "Nickname changed" : "Nickname reset",
        description: `${CE.success.str}\n\n${buildBullets([
          { label: "User",   value: `<@${target.id}>` },
          { label: "Before", value: oldNick },
          { label: "After",  value: nickname ?? `*(reset to ${target.username})*` },
        ])}`,
        thumbnail: target.displayAvatarURL({ size: 256 }),
        color: COLORS.success,
      })],
      flags: 1 << 6,
    });
  },
};

export default command;