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
} from "discord.js";
import { getGuildConfig } from "../storage/config";
import { CE, COLORS } from "../utils/embedStyle";
import { listProfiles, listStaffRoles, addStaffRating, setFeedbackCooldown } from "../storage/staff";
import { getQuota, currentWeekStart } from "../storage/quota";
import { getActiveInfractions } from "../storage/staff";
import { errorEmbed, successEmbed } from "../utils/embedStyle";

const PAGE_SIZE = 25;

export async function buildPortalMessage(guild: Guild, page: number) {
  const config = await getGuildConfig(guild.id);
  const enabled = config.modules?.staffDirectory;
  if (!enabled) {
    return { embeds: [errorEmbed("Module Disabled", "The Staff Directory module is currently disabled.")], components: [] };
  }

  const embed = new EmbedBuilder()
    .setTitle("BetterDark Staff Directory & Feedback Portal")
    .setDescription(
      `Welcome to the Staff Directory! Use the dropdown menu below to view public profiles of our active staff members.\n\n` +
      `You can also use this portal to submit feedback, file complaints, or report issues directly to the server management.\n\n` +
      `**All submissions are securely logged and reviewed by Server Administrators.**`
    )
    .setColor(0x2b2d31)
    .setImage("https://files.catbox.moe/uul77u.png");

  const profiles = await listProfiles(guild.id);
  const activeProfiles = profiles.filter(p => !p.terminated && p.currentRoleId);
  const staffRoles = await listStaffRoles(guild.id);
  
  activeProfiles.sort((a, b) => {
    const rA = staffRoles.find(r => r.roleId === a.currentRoleId)?.position ?? 999;
    const rB = staffRoles.find(r => r.roleId === b.currentRoleId)?.position ?? 999;
    return rA - rB;
  });

  const totalPages = Math.ceil(activeProfiles.length / PAGE_SIZE) || 1;
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageProfiles = activeProfiles.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const select = new StringSelectMenuBuilder()
    .setCustomId("staff_dir_select")
    .setPlaceholder("Select a staff member...");

  if (pageProfiles.length === 0) {
    select.addOptions([{ label: "No staff members found", value: "none", description: "There are currently no staff members." }]);
    select.setDisabled(true);
  } else {
    for (const p of pageProfiles) {
      try {
        const member = await guild.members.fetch(p.userId).catch(() => null);
        const name = member ? member.user.username : `Unknown (${p.userId})`;
        const role = member && p.currentRoleId ? member.roles.cache.get(p.currentRoleId)?.name : "Staff";
        select.addOptions([
          {
            label: name,
            description: `${role ?? "Staff"} | ID: ${p.userId}`,
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
        .setCustomId(`staff_dir_prev_${safePage}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`staff_dir_next_${safePage}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === totalPages - 1)
    );
    components.push(row2);
  }

  return { embeds: [embed], components };
}

export async function handlePortalInteraction(interaction: Interaction) {
  if (!interaction.inGuild()) return;

  if (interaction.isStringSelectMenu() && interaction.customId === "staff_dir_select") {
    await interaction.deferReply({ ephemeral: true });
    const targetId = interaction.values[0];
    if (targetId === "none") {
      await interaction.editReply({ content: "No staff member selected." });
      return;
    }

    const profiles = await listProfiles(interaction.guildId);
    const profile = profiles.find(p => p.userId === targetId);
    const member = await interaction.guild?.members.fetch(targetId).catch(() => null);
    
    if (!profile || !member) {
      await interaction.editReply({ embeds: [errorEmbed("Not Found", "Could not load this staff member's profile.")] });
      return;
    }

    const role = profile.currentRoleId ? interaction.guild?.roles.cache.get(profile.currentRoleId)?.name : "Unknown Role";
    
    const ratingSum = profile.ratingSum ?? 0;
    const ratingCount = profile.ratingCount ?? 0;
    const rating = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : "N/A";
    const stars = ratingCount > 0 ? "⭐".repeat(Math.round(ratingSum / ratingCount)) : "No ratings yet";

    const q = await getQuota(interaction.guildId, targetId);
    const currentWeek = q.weekly.find(w => w.weekStart === currentWeekStart(0));
    const msgs = currentWeek?.messages ?? 0;

    const warnings = getActiveInfractions(profile, "warning").length;
    const strikes = getActiveInfractions(profile, "strike").length;

    const embed = new EmbedBuilder()
      .setTitle(`Public Profile — ${member.user.username}`)
      .setThumbnail(member.user.displayAvatarURL())
      .setColor(COLORS.primary)
      .addFields(
        { name: "Role", value: role ?? "Unknown", inline: true },
        { name: "Rating", value: `${stars} (${rating})`, inline: true },
        { name: "Activity Summary", value: `Messages: **${msgs}**\nWarnings: **${warnings}**\nStrikes: **${strikes}**`, inline: false }
      )
      .setFooter({ text: `ID: ${targetId}` });

    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`staff_dir_feedback_${targetId}`)
        .setLabel("Give Feedback")
        .setStyle(ButtonStyle.Success)
        .setEmoji(CE.success.id ?? "📝"),
      new ButtonBuilder()
        .setCustomId(`staff_dir_complaint_${targetId}`)
        .setLabel("File Complaint")
        .setStyle(ButtonStyle.Danger)
        .setEmoji(CE.error.id ?? "⚠️")
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  }

  if (interaction.isButton() && interaction.customId.startsWith("staff_dir_prev_")) {
    const page = parseInt(interaction.customId.replace("staff_dir_prev_", ""), 10);
    const msg = await buildPortalMessage(interaction.guild!, page - 1);
    await interaction.update(msg);
  }

  if (interaction.isButton() && interaction.customId.startsWith("staff_dir_next_")) {
    const page = parseInt(interaction.customId.replace("staff_dir_next_", ""), 10);
    const msg = await buildPortalMessage(interaction.guild!, page + 1);
    await interaction.update(msg);
  }

  if (interaction.isButton() && interaction.customId.startsWith("staff_dir_feedback_")) {
    const targetId = interaction.customId.replace("staff_dir_feedback_", "");
    const modal = new ModalBuilder()
      .setCustomId(`staff_modal_feedback_${targetId}`)
      .setTitle("Give Feedback");

    const ratingInput = new TextInputBuilder()
      .setCustomId("rating")
      .setLabel("Rating (1-5)")
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
    
    // Check 24h cooldown
    const profiles = await listProfiles(interaction.guildId);
    const profile = profiles.find(p => p.userId === targetId);
    const lastFeedback = profile?.feedbackCooldowns?.[interaction.user.id] ?? 0;
    if (Date.now() - lastFeedback < 24 * 60 * 60 * 1000) {
      await interaction.editReply({ embeds: [errorEmbed("Cooldown Active", "You can only submit feedback or complain about this staff member once every 24 hours.")] });
      return;
    }

    const ratingStr = interaction.fields.getTextInputValue("rating");
    const comments = interaction.fields.getTextInputValue("comments");
    
    let rating = parseInt(ratingStr, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      await interaction.editReply({ embeds: [errorEmbed("Invalid Rating", "Please provide a number between 1 and 5.")] });
      return;
    }

    await addStaffRating(interaction.guildId, targetId, rating);
    await setFeedbackCooldown(interaction.guildId, targetId, interaction.user.id);
    await logFeedback(interaction, targetId, "Feedback", rating, comments);
    await interaction.editReply({ embeds: [successEmbed("Feedback Submitted", "Thank you! Your feedback has been securely submitted to the management team.")] });
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("staff_modal_complaint_")) {
    await interaction.deferReply({ ephemeral: true });
    const targetId = interaction.customId.replace("staff_modal_complaint_", "");
    
    // Check 24h cooldown
    const profiles = await listProfiles(interaction.guildId);
    const profile = profiles.find(p => p.userId === targetId);
    const lastFeedback = profile?.feedbackCooldowns?.[interaction.user.id] ?? 0;
    if (Date.now() - lastFeedback < 24 * 60 * 60 * 1000) {
      await interaction.editReply({ embeds: [errorEmbed("Cooldown Active", "You can only submit feedback or complain about this staff member once every 24 hours.")] });
      return;
    }

    const comments = interaction.fields.getTextInputValue("comments");
    
    await setFeedbackCooldown(interaction.guildId, targetId, interaction.user.id);
    await logFeedback(interaction, targetId, "Complaint", null, comments);
    await interaction.editReply({ embeds: [successEmbed("Complaint Submitted", "Thank you! Your complaint has been securely submitted to the management team.")] });
  }
}

async function logFeedback(interaction: Interaction, targetId: string, type: "Feedback" | "Complaint", rating: number | null, comments: string) {
  if (!interaction.guild) return;
  const config = await getGuildConfig(interaction.guild.id);
  const logChannelId = config.channels.staffDirectoryLog;
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
    embed.addFields({ name: "Rating", value: `${rating}/5`, inline: true });
  }

  embed.addFields({ name: "Comments", value: comments, inline: false });

  await channel.send({ embeds: [embed] }).catch(() => {});
}
