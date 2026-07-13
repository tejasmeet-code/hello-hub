import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
  type MessageActionRowComponentBuilder,
  type Guild,
  MessageFlags,
} from "discord.js";
import { getGuildConfig } from "../storage/config";
import { CE, COLORS } from "../utils/embedStyle";
import { listProfiles, addStaffRating, setFeedbackCooldown, getProfile } from "../storage/staff";
import { getQuota, currentWeekStart } from "../storage/quota";
import { getActiveInfractions } from "../storage/staff";
import { errorEmbed, successEmbed } from "../utils/embedStyle";
import { isAdminOrOwner } from "../utils/staffPerms";

const PAGE_SIZE = 25;

function formatStarRating(avgRating: number | null): string {
  if (avgRating === null || isNaN(avgRating)) return "No ratings yet";
  const normalized = avgRating > 5 ? avgRating / 2 : avgRating;
  const clamped = Math.max(0, Math.min(5, Math.round(normalized)));
  return "⭐".repeat(clamped) + "☆".repeat(5 - clamped) + ` (${normalized.toFixed(1)}/5)`;
}

export async function buildPortalMessage(guild: Guild) {
  const config = await getGuildConfig(guild.id);
  const enabled = config.modules?.staffDirectory;
  if (!enabled) {
    return { embeds: [errorEmbed("Module Disabled", "The Staff Directory module is currently disabled.")], components: [] };
  }

  const embed = new EmbedBuilder()
    .setTitle(`${CE.staff?.str || "👥"} ${guild.name} Staff Directory & Feedback Portal`)
    .setDescription(
      `${CE.information?.str || "ℹ️"} Welcome to the **Staff Directory**! Click the button below to view public profiles of our active staff members.\n\n` +
      `${CE.moderation?.str || "🛡️"} You can also use this portal to submit feedback, file complaints, or report issues directly to the server management.\n\n` +
      `${CE.admin?.str || "⚙️"} **All submissions are securely logged and reviewed by Server Administrators.**`
    )
    .setColor(0x2b2d31)
    .setThumbnail(guild.iconURL({ size: 1024 }) ?? null)
    .setImage("https://files.catbox.moe/uul77u.png");

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`staff_dir_browse_0`)
      .setLabel("Browse Staff Directory")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(CE.staff?.id ?? "👥")
  );

  return { embeds: [embed], components: [row] };
}

export async function handlePortalInteraction(interaction: Interaction) {
  if (!interaction.inGuild()) return;

  if (interaction.isButton() && interaction.customId.startsWith("staff_dir_browse_")) {
    const page = parseInt(interaction.customId.replace("staff_dir_browse_", ""), 10);
    
    const config = await getGuildConfig(interaction.guildId!);
    const portalRoleIds = config.moduleRoles?.staffDirectory || [];
    
    if (portalRoleIds.length === 0) {
      await interaction.reply({ embeds: [errorEmbed("Configuration Error", "No Staff Roles have been configured for the portal. An admin needs to set permissions in `/config`.")], ephemeral: true });
      return;
    }
    // The main portal message is not ephemeral. The pagination messages are ephemeral.
    const isEphemeral = interaction.message.flags.has(MessageFlags.Ephemeral);
    if (isEphemeral) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ ephemeral: true });
    }

    // Fetch all members to ensure role.members is accurate
    await interaction.guild?.members.fetch();

    const activeStaffMap = new Map<string, { userId: string; roleName: string; position: number }>();
    for (const rId of portalRoleIds) {
      const role = interaction.guild?.roles.cache.get(rId);
      if (role) {
        for (const member of role.members.values()) {
          const highestHoisted = member.roles.cache.filter(r => r.hoist).sort((a, b) => b.position - a.position).first() || member.roles.highest;
          activeStaffMap.set(member.id, {
            userId: member.id,
            roleName: highestHoisted ? highestHoisted.name : role.name,
            position: highestHoisted ? highestHoisted.position : role.position,
          });
        }
      }
    }
    const activeStaff = Array.from(activeStaffMap.values()).sort((a, b) => b.position - a.position);

    const totalPages = Math.ceil(activeStaff.length / PAGE_SIZE) || 1;
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const pageProfiles = activeStaff.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

    const select = new StringSelectMenuBuilder()
      .setCustomId("staff_dir_select")
      .setPlaceholder("Select a staff member...");

    if (pageProfiles.length === 0) {
      select.addOptions([{ label: "No staff members found", value: "none", description: "There are currently no staff members." }]);
      select.setDisabled(true);
    } else {
      for (const p of pageProfiles) {
        try {
          const member = await interaction.guild?.members.fetch(p.userId).catch(() => null);
          const name = member ? member.user.username : `Unknown (${p.userId})`;
          select.addOptions([
            {
              label: name,
              description: `${p.roleName} | ID: ${p.userId}`,
              value: p.userId,
              emoji: { id: CE.members.id }
            }
          ]);
        } catch (e) {
          continue;
        }
      }
    }

    const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [row1];

    if (totalPages > 1) {
      const row2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`staff_dir_browse_${safePage - 1}`)
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage === 0),
        new ButtonBuilder()
          .setCustomId(`staff_dir_browse_${safePage + 1}`)
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage === totalPages - 1)
      );
      components.push(row2);
    }
    
    
    if (isEphemeral) {
      await interaction.editReply({ content: "Select a staff member from the dropdown below:", components });
    } else {
      await interaction.editReply({ content: "Select a staff member from the dropdown below:", components });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "staff_dir_select") {
    await interaction.deferUpdate();
    const targetId = interaction.values[0];
    if (targetId === "none") {
      return;
    }

    const profile = await getProfile(interaction.guildId!, targetId);
    const member = await interaction.guild?.members.fetch(targetId).catch(() => null);
    
    if (!member) {
      await interaction.editReply({ content: "Staff member not found.", embeds: [], components: [] });
      return;
    }

    const ratingSum = profile?.ratingSum ?? 0;
    const ratingCount = profile?.ratingCount ?? 0;
    const avgRating = ratingCount > 0 ? ratingSum / ratingCount : null;
    const highestHoisted = member.roles.cache.filter(r => r.hoist).sort((a, b) => b.position - a.position).first() || member.roles.highest;
    
    const embed = new EmbedBuilder()
      .setTitle(`Staff Profile: ${member.user.username}`)
      .setThumbnail(member.user.displayAvatarURL())
      .setColor(0x2b2d31)
      .addFields(
        { name: "Highest Role", value: highestHoisted ? `<@&${highestHoisted.id}>` : "None", inline: true },
        { name: "Average Rating", value: formatStarRating(avgRating), inline: true },
        { name: "Reviews", value: `${ratingCount}`, inline: true }
      );

    if (profile?.introduction) {
      embed.addFields({ name: "Introduction", value: profile.introduction, inline: false });
    }

    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`staff_dir_feedback_${targetId}`)
        .setLabel("Rate Staff")
        .setStyle(ButtonStyle.Success)
        .setEmoji(CE.level?.id ?? "1517480037719212032"),
      new ButtonBuilder()
        .setCustomId(`staff_dir_complaint_${targetId}`)
        .setLabel("File Complaint")
        .setStyle(ButtonStyle.Danger)
        .setEmoji(CE.warning?.id ?? "1517468806186799125")
    );

    await interaction.editReply({ content: "", embeds: [embed], components: [row] });
  }

  if (interaction.isButton() && interaction.customId.startsWith("staff_dir_feedback_")) {
    const targetId = interaction.customId.replace("staff_dir_feedback_", "");
    const modal = new ModalBuilder()
      .setCustomId(`staff_modal_feedback_${targetId}`)
      .setTitle("Rate Staff");

    const ratingInput = new TextInputBuilder()
      .setCustomId("rating")
      .setLabel("Rating (1-5 stars)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(1);

    const commentsInput = new TextInputBuilder()
      .setCustomId("comments")
      .setLabel("Comments")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(ratingInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(commentsInput)
    );

    await interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId.startsWith("staff_dir_complaint_")) {
    const targetId = interaction.customId.replace("staff_dir_complaint_", "");
    const modal = new ModalBuilder()
      .setCustomId(`staff_modal_complaint_${targetId}`)
      .setTitle("File Complaint");

    const commentsInput = new TextInputBuilder()
      .setCustomId("comments")
      .setLabel("Please describe the issue")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(commentsInput));

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("staff_modal_feedback_")) {
    await interaction.deferReply({ ephemeral: true });
    const targetId = interaction.customId.replace("staff_modal_feedback_", "");
    
    const profile = await getProfile(interaction.guildId!, targetId);
    const lastFeedback = profile?.feedbackCooldowns?.[interaction.user.id] ?? 0;
    if (Date.now() - lastFeedback < 24 * 60 * 60 * 1000) {
      await interaction.editReply({ embeds: [errorEmbed("Cooldown Active", "You can only submit feedback or complain about this staff member once every 24 hours.")] });
      return;
    }

    const ratingStr = interaction.fields.getTextInputValue("rating");
    const comments = interaction.fields.getTextInputValue("comments");
    
    let rating = parseInt(ratingStr, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      await interaction.editReply({ embeds: [errorEmbed("Invalid Rating", "Please provide a rating between 1 and 5 stars.")] });
      return;
    }

    await addStaffRating(interaction.guildId!, targetId, rating);
    await setFeedbackCooldown(interaction.guildId!, targetId, interaction.user.id);
    await logFeedback(interaction, targetId, "Feedback", rating, comments);
    await interaction.editReply({ embeds: [successEmbed("Feedback Submitted", "Thank you! Your feedback has been securely submitted to the management team.")] });
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("staff_modal_complaint_")) {
    await interaction.deferReply({ ephemeral: true });
    const targetId = interaction.customId.replace("staff_modal_complaint_", "");
    
    const profile = await getProfile(interaction.guildId!, targetId);
    const lastFeedback = profile?.feedbackCooldowns?.[interaction.user.id] ?? 0;
    if (Date.now() - lastFeedback < 24 * 60 * 60 * 1000) {
      await interaction.editReply({ embeds: [errorEmbed("Cooldown Active", "You can only submit feedback or complain about this staff member once every 24 hours.")] });
      return;
    }

    const comments = interaction.fields.getTextInputValue("comments");
    
    await setFeedbackCooldown(interaction.guildId!, targetId, interaction.user.id);
    await logFeedback(interaction, targetId, "Complaint", null, comments);
    await interaction.editReply({ embeds: [successEmbed("Complaint Submitted", "Thank you! Your complaint has been securely submitted to the management team.")] });
  }

  if (interaction.isButton() && interaction.customId.startsWith("staff_portal_reply_")) {
    if (!(await isAdminOrOwner(interaction as any))) {
      await interaction.reply({
        embeds: [errorEmbed("Permission Denied", "Only Server Administrators can reply to staff feedback.")],
        ephemeral: true,
      });
      return;
    }

    const submitterId = interaction.customId.replace("staff_portal_reply_", "");
    const modal = new ModalBuilder()
      .setCustomId(`staff_portal_modal_${submitterId}`)
      .setTitle("Reply to Submitter via DM");

    const msgInput = new TextInputBuilder()
      .setCustomId("reply_msg")
      .setLabel("Response Message")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1500);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(msgInput));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("staff_portal_modal_")) {
    await interaction.deferReply({ ephemeral: true });
    if (!(await isAdminOrOwner(interaction as any))) {
      await interaction.editReply({
        embeds: [errorEmbed("Permission Denied", "Only Server Administrators can reply to staff feedback.")],
      });
      return;
    }

    const submitterId = interaction.customId.replace("staff_portal_modal_", "");
    const replyText = interaction.fields.getTextInputValue("reply_msg");

    const submitter = await interaction.client.users.fetch(submitterId).catch(() => null);
    if (!submitter) {
      await interaction.editReply({
        embeds: [errorEmbed("User Not Found", "Could not fetch the submitter to send a DM.")],
      });
      return;
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle("💬 Response to your Staff Feedback / Complaint")
      .setDescription(`Server Management from **${interaction.guild?.name || "the server"}** has replied to your submission:\n\n>>> ${replyText}`)
      .setColor(COLORS.info ?? 0x3498db)
      .setFooter({ text: `Replied by Admin (${interaction.user.tag})` })
      .setTimestamp();

    try {
      await submitter.send({ embeds: [dmEmbed] });
      await interaction.editReply({
        embeds: [successEmbed("Reply Sent", `Successfully sent response DM to <@${submitterId}>.`)],
      });
    } catch {
      await interaction.editReply({
        embeds: [errorEmbed("DM Failed", `Could not deliver DM to <@${submitterId}> (they may have DMs disabled).`)],
      });
    }
  }
}

async function logFeedback(interaction: Interaction, targetId: string, type: "Feedback" | "Complaint", rating: number | null, comments: string) {
  if (!interaction.guild) return;
  const config = await getGuildConfig(interaction.guild.id);
  const logChannelId = config.channels.staffFeedbackLog || config.channels.staffDirectoryLog;
  if (!logChannelId) return;

  const channel = interaction.guild.channels.cache.get(logChannelId);
  if (!channel || !channel.isTextBased()) return;

  const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
  const targetTag = targetMember ? targetMember.user.tag : targetId;

  const embed = new EmbedBuilder()
    .setTitle(`New Staff ${type}`)
    .setColor(type === "Feedback" ? COLORS.success : COLORS.danger)
    .addFields(
      { name: "Staff Member", value: `${targetTag} (<@${targetId}>)`, inline: true },
      { name: "Submitted By", value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
    )
    .setTimestamp();

  if (rating !== null) {
    embed.addFields({ name: "Rating", value: formatStarRating(rating), inline: true });
  }

  embed.addFields({ name: "Comments", value: comments || "No comments provided." });

  const replyRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`staff_portal_reply_${interaction.user.id}`)
      .setLabel("Reply to Submitter via DM")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(CE.information?.id ?? "1517488940381376512")
  );

  await channel.send({ embeds: [embed], components: [replyRow] }).catch(() => null);
}
