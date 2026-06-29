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

const PAGE_SIZE = 25;

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

    const activeStaff: { userId: string; roleName: string }[] = [];
    for (const rId of portalRoleIds) {
      const role = interaction.guild?.roles.cache.get(rId);
      if (role) {
        for (const member of role.members.values()) {
          if (!activeStaff.some(s => s.userId === member.id)) {
            activeStaff.push({ userId: member.id, roleName: role.name });
          }
        }
      }
    }

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
              emoji: { name: "👤" }
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
    const rating = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : "N/A";
    
    const embed = new EmbedBuilder()
      .setTitle(`Staff Profile: ${member.user.username}`)
      .setThumbnail(member.user.displayAvatarURL())
      .setColor(0x2b2d31)
      .addFields(
        { name: "Average Rating", value: rating !== "N/A" ? `${rating}/10 🌟` : "No ratings yet", inline: true },
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
        .setEmoji("🌟"),
      new ButtonBuilder()
        .setCustomId(`staff_dir_complaint_${targetId}`)
        .setLabel("File Complaint")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("⚠️")
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
      .setLabel("Rating (1-10)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2);

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
    if (isNaN(rating) || rating < 1 || rating > 10) {
      await interaction.editReply({ embeds: [errorEmbed("Invalid Rating", "Please provide a number between 1 and 10.")] });
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
    embed.addFields({ name: "Rating", value: `${rating}/10`, inline: true });
  }

  embed.addFields({ name: "Comments", value: comments || "No comments provided." });

  await channel.send({ embeds: [embed] }).catch(() => null);
}
