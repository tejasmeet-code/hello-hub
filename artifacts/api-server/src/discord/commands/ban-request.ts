import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  ChannelType,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { getGuildConfig } from "../storage/config";
import { createCase } from "../storage/cases";
import { recordModStat } from "../storage/modstats";
import { bumpModAction } from "../storage/quota";
import { COLORS, CE, prettyEmbed, buildBullets, successEmbed, errorEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ban-request")
    .setDescription("Submit a ban request for review by authorized roles.")
    .addUserOption((o) =>
      o.setName("user").setDescription("User to request a ban for").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason for the ban request").setRequired(true).setMaxLength(512),
    )
    .addStringOption((o) =>
      o.setName("proof").setDescription("Link to proof (image/video URL)").setRequired(false),
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "ban-request"))) return;
    if (!interaction.guild || !interaction.guildId) return;

    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    const proof = interaction.options.getString("proof");

    if (target.id === interaction.user.id) {
      await interaction.reply({ content: "You can't request a ban on yourself.", flags: 1 << 6 });
      return;
    }

    await interaction.deferReply();

    const cfg = await getGuildConfig(interaction.guildId);
    const banReqChannelId = cfg.channels.banRequest;

    if (!banReqChannelId) {
      await interaction.editReply({
        embeds: [errorEmbed("No channel configured", "Set a **Ban Request** channel via `/config → Ban Request → Set Channel` first.")],
      });
      return;
    }

    const channel = interaction.guild.channels.cache.get(banReqChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.editReply({ embeds: [errorEmbed("Channel not found", "The configured ban request channel is invalid.")] });
      return;
    }

    const embed = prettyEmbed({
      title: "Ban Request",
      color: COLORS.danger,
      description: `${CE.moderation.str}\n\n${buildBullets([
        { label: "Target",       value: `<@${target.id}> — ${target.tag}` },
        { label: "Requested by", value: `<@${interaction.user.id}> — ${interaction.user.tag}` },
        { label: "Reason",       value: reason },
        ...(proof ? [{ label: "Proof", value: proof }] : []),
      ])}`,
      thumbnail: target.displayAvatarURL({ size: 256 }),
      footer: "Relosta Bot",
      timestamp: true,
    });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`banreq:accept:${target.id}:${interaction.user.id}:${encodeURIComponent(reason)}`)
        .setLabel("Accept — Ban User")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`banreq:reject:${target.id}:${interaction.user.id}`)
        .setLabel("Reject")
        .setStyle(ButtonStyle.Secondary),
    );

    await channel.send({ embeds: [embed], components: [row] });

    await interaction.editReply({
      embeds: [successEmbed("Ban request submitted", `Your request to ban **${target.tag}** has been sent for review.`)],
    });
  },
};

export default command;

/**
 * Handle ban-request button interactions from client.ts interactionCreate handler.
 */
export async function handleBanRequestButton(i: ButtonInteraction): Promise<void> {
  if (!i.guild || !i.guildId) return;
  const parts = i.customId.split(":");
  const action = parts[1];
  const targetId = parts[2];
  const requesterId = parts[3];
  const reason = parts[4] ? decodeURIComponent(parts[4]) : "No reason provided";

  if (action === "accept") {
    const target = await i.guild.members.fetch(targetId).catch(() => null);
    if (!target) {
      await i.reply({ content: "User is no longer in the server.", flags: 1 << 6 });
    } else {
      try {
        await target.ban({ reason: `Ban request accepted by ${i.user.tag}: ${reason}` });
        const caseEntry = await createCase({
          guildId: i.guildId,
          action: "ban",
          moderatorId: i.user.id,
          targetId,
          reason: `[Ban Request] ${reason}`,
        });
        await recordModStat({ guildId: i.guildId, modId: i.user.id, targetId, action: "ban", delta: 1, reason });
        const cfg = await getGuildConfig(i.guildId);
        await bumpModAction(i.guildId, requesterId, cfg.quotaConfig?.weekStartDay ?? 0);

        const updated = EmbedBuilder.from(i.message.embeds[0])
          .setColor(COLORS.danger)
          .setFooter({ text: `Accepted by ${i.user.tag} — Case #${caseEntry.case_number} • Relosta Bot` });
        await i.update({ embeds: [updated], components: [] });

        const requester = await i.client.users.fetch(requesterId).catch(() => null);
        requester?.send({
          embeds: [successEmbed("Ban Request Accepted", `Your ban request for <@${targetId}> was accepted — Case #${caseEntry.case_number}.`)],
        }).catch(() => {});
      } catch {
        await i.reply({ content: "Failed to ban that user.", flags: 1 << 6 });
      }
    }
  } else if (action === "reject") {
    const updated = EmbedBuilder.from(i.message.embeds[0])
      .setColor(COLORS.neutral)
      .setFooter({ text: `Rejected by ${i.user.tag} • Relosta Bot` });
    await i.update({ embeds: [updated], components: [] });

    const requester = await i.client.users.fetch(requesterId).catch(() => null);
    requester?.send({
      embeds: [{ title: "Ban Request Rejected", description: `Your ban request was rejected by ${i.user.tag}.`, color: COLORS.neutral }],
    }).catch(() => {});
  }
}