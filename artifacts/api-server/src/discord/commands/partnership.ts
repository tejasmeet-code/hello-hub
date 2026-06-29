import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type TextChannel,
  type ButtonInteraction,
  ChannelType,
} from "discord.js";
import type { SlashCommand } from "../types";
import { addPartnershipSubmission, updatePartnershipStatus, getPartnerships } from "../storage/partnerships";
import { getGuildConfig, getPartnershipConfig } from "../storage/config";
import { incrementPartnershipScore, getProfile } from "../storage/staff";
import { CE } from "../utils/embedStyle";
import { logger } from "../../lib/logger";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("partnership")
    .setDescription("Submit a partnership request for review")
    .setDMPermission(false)
    .addAttachmentOption((option) =>
      option
        .setName("proof")
        .setDescription("Optional: attach image proof (set this before the form opens)")
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: 1 << 6,
      });
      return;
    }

    // Capture proof attachment BEFORE showing the modal — slash command options
    // are only accessible on the original interaction, not the modal submission.
    const proofAttachment = interaction.options.getAttachment("proof");

    // Show modal so the message field supports multi-paragraph text
    const modal = new ModalBuilder()
      .setCustomId("partnership_submit")
      .setTitle("Submit a Partnership")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("message")
            .setLabel("Partnership Message")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000)
            .setPlaceholder("Write your full partnership message here. Multiple paragraphs are supported."),
        ),
      );

    await interaction.showModal(modal);

    // Wait up to 5 minutes for the user to fill in and submit the form
    let submit;
    try {
      submit = await interaction.awaitModalSubmit({
        filter: (s) =>
          s.customId === "partnership_submit" && s.user.id === interaction.user.id,
        time: 5 * 60 * 1000,
      });
    } catch {
      // Timed out — the modal was dismissed or ignored; nothing to do
      return;
    }

    // Defer the modal reply so we can do async work
    await submit.deferReply();

    const cfg = await getGuildConfig(interaction.guildId);
    if (!cfg.modules.partnership) {
      await submit.editReply({ content: `${CE.error.str} Partnership module is disabled.` });
      return;
    }

    const message = submit.fields.getTextInputValue("message").trim();

    let proof: string | undefined;
    if (proofAttachment) {
      const contentType = proofAttachment.contentType?.toLowerCase() ?? "";
      if (contentType.startsWith("image/") || contentType.startsWith("video/")) {
        proof = proofAttachment.url;
      } else {
        await submit.editReply({ content: `${CE.error.str} Proof must be an image or video attachment.` });
        return;
      }
    }

    const submission = await addPartnershipSubmission(interaction.guildId, {
      staffUserId: interaction.user.id,
      message,
      proof,
    });

    // Route to review channel — nothing is posted publicly at this point.
    // The partnership announcement only goes out AFTER a manager clicks Approve.
    const checkChannelId = cfg.channels.partnershipCheck;
    let deliveredToReview = false;

    if (checkChannelId) {
      try {
        const guild = interaction.guild!;
        const fetched = await guild.channels.fetch(checkChannelId);
        if (!fetched || fetched.type !== ChannelType.GuildText) {
          throw new Error("Channel is not a text channel");
        }
        const channel = fetched as TextChannel;

        const reviewEmbed = new EmbedBuilder()
          .setTitle(`${CE.link.str} Partnership Request — Pending Approval`)
          .setDescription(
            `Submitted by <@${interaction.user.id}>\n\n` +
            `**This has NOT been posted publicly yet.** ` +
            `Choose an **Accept** option to publish the announcement, or **Reject** to decline.`,
          )
          .addFields(
            { name: "Partnership Message", value: message, inline: false },
            ...(proof ? [{ name: "Proof", value: proof, inline: false }] : []),
          )
          .setColor(0xfee75c)
          .setTimestamp(submission.submittedAt);

        if (proof && proofAttachment?.contentType?.startsWith("image/")) {
          reviewEmbed.setImage(proof);
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`partnership_accept:${submission.id}`)
            .setLabel("Accept")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`partnership_accept_everyone:${submission.id}`)
            .setLabel("Accept with everyone ping")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`partnership_accept_here:${submission.id}`)
            .setLabel("Accept with here ping")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`partnership_reject:${submission.id}`)
            .setLabel("Reject")
            .setStyle(ButtonStyle.Danger),
        );

        await channel.send({ embeds: [reviewEmbed], components: [row] });
        deliveredToReview = true;
      } catch (err) {
        logger.error({ err }, "Failed to deliver partnership submission to review channel");
      }
    }

    const replyContent = deliveredToReview
      ? `${CE.success.str} Your partnership request is **pending approval** — nothing has been posted publicly yet. A manager will review it shortly.`
      : `${CE.warning.str} Partnership request saved, but no review channel is configured. Ask an admin to set the Partnership Approval Channel in \`/config\`.`;

    await submit.editReply({ content: replyContent });
  },
};

export async function handlePartnershipButton(interaction: ButtonInteraction) {
  if (!interaction.inGuild() || !interaction.guildId) return;

  const colonIdx = interaction.customId.indexOf(":");
  const action = colonIdx === -1 ? interaction.customId : interaction.customId.slice(0, colonIdx);
  const submissionId = colonIdx === -1 ? "" : interaction.customId.slice(colonIdx + 1);

  if (!submissionId) return;

  const cfg = await getGuildConfig(interaction.guildId);
  if (!cfg.modules.partnership) {
    await interaction.reply({ content: `${CE.error.str} Partnership module is disabled.`, ephemeral: true });
    return;
  }

  const partnershipCfg = getPartnershipConfig(cfg);

  const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Could not fetch your member data.", ephemeral: true });
    return;
  }

  const isAdmin = member.permissions.has("Administrator");
  const isManager =
    cfg.managers.userIds.includes(interaction.user.id) ||
    cfg.managers.roleIds.some((roleId) => member.roles.cache.has(roleId));

  if (!isAdmin && !isManager) {
    await interaction.reply({ content: "You don't have permission to review partnerships.", ephemeral: true });
    return;
  }

  if (
    action === "partnership_accept" ||
    action === "partnership_accept_everyone" ||
    action === "partnership_accept_here"
  ) {
    const success = await updatePartnershipStatus(
      interaction.guildId,
      submissionId,
      "approved",
      interaction.user.id,
    );

    if (!success) {
      await interaction.reply({ content: "Partnership submission not found.", ephemeral: true });
      return;
    }

    const allPartnerships = await getPartnerships(interaction.guildId);
    const submission = allPartnerships.find((p) => p.id === submissionId);

    if (submission) {
      await incrementPartnershipScore(interaction.guildId, submission.staffUserId).catch(() => {});

      // Announce to partnership channel (without proof)
      const announceChannelId = cfg.channels.partnership;
      if (announceChannelId) {
        try {
          const channel = await interaction.guild!.channels.fetch(announceChannelId) as TextChannel;
          const pingContent =
            action === "partnership_accept_everyone"
              ? "@everyone"
              : action === "partnership_accept_here"
                ? "@here"
                : null;

          if (pingContent) {
            await channel.send({
              content: pingContent,
              allowedMentions: {
                parse: ["everyone"],
              },
            });
          }

          const announcementEmbed = new EmbedBuilder()
            .setTitle("Server Ads")
            .setDescription(submission.message)
            .setColor(0x2b2d31)
            .setTimestamp();
          
          await channel.send({ embeds: [announcementEmbed] });
        } catch (err) {
          logger.warn({ err }, "Failed to post partnership announcement");
        }
      }
    }

    await interaction.update({
      content: `${CE.success.str} **Accepted** by <@${interaction.user.id}> — partnership announcement posted.`,
      embeds: [],
      components: [],
    });

  } else if (action === "partnership_reject") {
    const modal = new ModalBuilder()
      .setCustomId(`partnership_reject_modal:${submissionId}`)
      .setTitle("Reject Partnership")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Rejection Reason")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder("Reason for rejection..."),
        ),
      );

    await interaction.showModal(modal);

    try {
      const submit = await interaction.awaitModalSubmit({
        filter: (s) =>
          s.customId === `partnership_reject_modal:${submissionId}` &&
          s.user.id === interaction.user.id,
        time: 5 * 60 * 1000,
      });

      const reason = submit.fields.getTextInputValue("reason").trim();

      const success = await updatePartnershipStatus(
        interaction.guildId,
        submissionId,
        "rejected",
        interaction.user.id,
        reason,
      );

      if (!success) {
        await submit.reply({ content: "Partnership submission not found.", ephemeral: true });
        return;
      }

      const allPartnerships = await getPartnerships(interaction.guildId);
      const submission = allPartnerships.find((p) => p.id === submissionId);
      if (submission) {
        const staffProfile = await getProfile(interaction.guildId, submission.staffUserId).catch(() => null);
        if (staffProfile) {
          const failureCount = allPartnerships.filter(
            (p) => p.staffUserId === submission.staffUserId && p.status === "rejected",
          ).length;
          const failureAction =
            partnershipCfg.failureActions[Math.min(failureCount, 3) as 1 | 2 | 3] ?? "none";
          logger.info(
            { guildId: interaction.guildId, staffUserId: submission.staffUserId, failureCount, failureAction },
            "Partnership rejection failure action",
          );
        }
      }

      // Update the review embed to show it was rejected
      await interaction.message.edit({
        content: `${CE.error.str} **Rejected** by <@${interaction.user.id}>. Reason: ${reason}`,
        embeds: [],
        components: [],
      }).catch(() => {});

      await submit.reply({ content: `${CE.error.str} Partnership rejected.`, flags: 1 << 6 });
    } catch {
      // Modal timed out — nothing to do
    }
  }
}

export default command;