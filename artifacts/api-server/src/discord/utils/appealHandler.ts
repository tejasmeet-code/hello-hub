import {
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  TextChannel,
} from "discord.js";
import { createAppeal, updateAppealStatus, getAppeal } from "../storage/appeals";
import { getCase, editCase } from "../storage/cases";
import { getGuildConfig } from "../storage/config";
import { recordModStat } from "../storage/modstats";
import { COLORS, CE, prettyEmbed, buildBullets, successEmbed, errorEmbed } from "./embedStyle";

/**
 * Called when a user clicks the "Appeal" button in their punishment DM.
 * customId format: appeal:dm:{guildId}:{caseNumber}
 */
export async function handleAppealButton(i: ButtonInteraction): Promise<void> {
  const parts = i.customId.split(":");
  const guildId = parts[2]!;
  const caseNumber = parseInt(parts[3]!, 10);

  // Show modal immediately — users can always appeal, no duplicate check
  const modal = new ModalBuilder()
    .setCustomId(`appeal:submit:${guildId}:${caseNumber}`)
    .setTitle("Submit an Appeal")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("punishment_type")
          .setLabel("What punishment are you appealing?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("why_happened")
          .setLabel("Why did this punishment happen?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("defense")
          .setLabel("Why should this be overturned?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("proof")
          .setLabel("Proof / evidence links (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200),
      ),
    );

  await i.showModal(modal);
}

/**
 * Called when the appeal modal is submitted.
 * customId format: appeal:submit:{guildId}:{caseNumber}
 */
export async function handleAppealModalSubmit(i: any): Promise<void> {
  const parts = i.customId.split(":");
  const guildId = parts[2];
  const caseNumber = parseInt(parts[3], 10);

  const punishmentType = i.fields.getTextInputValue("punishment_type");
  const whyHappened = i.fields.getTextInputValue("why_happened");
  const defense = i.fields.getTextInputValue("defense");
  const proof = i.fields.getTextInputValue("proof") || null;

  try {
    const appeal = await createAppeal({
      guildId,
      caseNumber,
      userId: i.user.id,
      punishmentType,
      whyHappened,
      defense,
      proof,
    });

    const cfg = await getGuildConfig(guildId);
    // Use the dedicated appeals channel set via /config
    const appealChannelId = cfg.channels.appeals;

    if (appealChannelId) {
      const guild = i.client.guilds.cache.get(guildId);
      const channel = guild?.channels.cache.get(appealChannelId);
      if (channel && channel.type === ChannelType.GuildText) {
        const caseEntry = await getCase(guildId, caseNumber).catch(() => null);
        const embed = prettyEmbed({
          title: `New Appeal — Case #${caseNumber}`,
          color: COLORS.warning,
          description: `${CE.information.str}\n\n${buildBullets([
            { label: "User",            value: `<@${i.user.id}> — ${i.user.tag}` },
            { label: "Case #",          value: String(caseNumber) },
            { label: "Punishment Type", value: punishmentType },
            { label: "Moderator",       value: caseEntry ? `<@${caseEntry.moderator_id}>` : "Unknown" },
            { label: "Original Reason", value: caseEntry?.reason ?? "Unknown" },
            { label: "Why it happened", value: whyHappened },
            { label: "Defense",         value: defense },
            ...(proof ? [{ label: "Proof", value: proof }] : []),
          ])}`,
          thumbnail: i.user.displayAvatarURL({ size: 256 }),
          footer: `Appeal ID #${appeal.id} • Relosta Bot`,
        });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`appeal:accept:${guildId}:${appeal.id}`)
            .setLabel("Accept Appeal")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`appeal:reject:${guildId}:${appeal.id}`)
            .setLabel("Reject Appeal")
            .setStyle(ButtonStyle.Danger),
        );

        await (channel as any).send({ embeds: [embed], components: [row] });
      }
    }

    await i.reply({
      embeds: [successEmbed(
        "Appeal submitted",
        `Your appeal (ID #${appeal.id}) has been submitted and will be reviewed by staff. You'll receive a DM when a decision is made.`,
      )],
      flags: 1 << 6,
    });
  } catch {
    await i.reply({ embeds: [errorEmbed("Failed", "Could not submit your appeal. Please try again.")] , flags: 1 << 6 });
  }
}

/**
 * Handle appeal review buttons (Accept/Reject).
 * customId: appeal:accept|reject:{guildId}:{appealId}
 */
export async function handleAppealReviewButton(i: ButtonInteraction): Promise<void> {
  const parts = i.customId.split(":");
  const action = parts[1] as "accept" | "reject";
  const guildId = parts[2]!;
  const appealId = parseInt(parts[3]!, 10);

  const appeal = await getAppeal(appealId);
  if (!appeal) {
    await i.reply({ content: "Appeal not found." , flags: 1 << 6 });
    return;
  }
  if (appeal.status !== "pending") {
    await i.reply({ content: `This appeal has already been **${appeal.status}**.` , flags: 1 << 6 });
    return;
  }

  await updateAppealStatus(appealId, action === "accept" ? "accepted" : "rejected", i.user.id);

  const color = action === "accept" ? COLORS.success : COLORS.danger;
  const label = action === "accept" ? `${CE.success.str} Accepted` : `${CE.error.str} Rejected`;

  const updatedEmbed = EmbedBuilder.from(i.message.embeds[0]!)
    .setColor(color)
    .setFooter({ text: `${label} by ${i.user.tag}` });

  await i.update({ embeds: [updatedEmbed], components: [] });

  if (action === "accept") {
    // Void the original case in Supabase
    await editCase(guildId, appeal.case_number, { active: false });

    // Deduct 1 from the moderator's stats
    const originalCase = await getCase(guildId, appeal.case_number);
    if (originalCase) {
      await recordModStat({
        guildId,
        modId: originalCase.moderator_id,
        targetId: originalCase.target_id,
        action: originalCase.action as any,
        delta: -1,
        reason: `Appeal #${appealId} accepted — case voided`,
      });

      // Auto-reverse the punishment
      const guild = i.client.guilds.cache.get(guildId);
      if (guild) {
        try {
          if (originalCase.action === "ban") {
            await guild.members.unban(appeal.user_id, `Appeal #${appealId} accepted by ${i.user.tag}`);
          } else if (originalCase.action === "mute") {
            const member = await guild.members.fetch(appeal.user_id).catch(() => null);
            if (member) await member.timeout(null, `Appeal #${appealId} accepted`);
          } else if (originalCase.action === "jail") {
            const member = await guild.members.fetch(appeal.user_id).catch(() => null);
            const jailRole = guild.roles.cache.find((r) => r.name === "Jailed");
            if (member && jailRole) await member.roles.remove(jailRole, `Appeal #${appealId} accepted`);
          }
        } catch {
          // Best-effort reversal; log silently
        }
      }

      // Try to create a server invite to include in the acceptance DM
      let inviteUrl = "";
      const guild2 = i.client.guilds.cache.get(guildId);
      if (guild2) {
        const textChannel = guild2.channels.cache.find(
          (c) => c.type === ChannelType.GuildText,
        ) as TextChannel | undefined;
        if (textChannel) {
          const inv = await textChannel.createInvite({ maxAge: 86400, maxUses: 1, reason: `Appeal #${appealId} accepted` }).catch(() => null);
          if (inv) inviteUrl = inv.url;
        }
      }

      // DM the user — acceptance
      const user = await i.client.users.fetch(appeal.user_id).catch(() => null);
      if (user) {
        user.send({
          embeds: [prettyEmbed({
            title: "Your Appeal Was Accepted",
            color: COLORS.success,
            description:
              `Your appeal for **Case #${appeal.case_number}** (${appeal.punishment_type}) has been **accepted**.\n\n` +
              `The punishment has been automatically reversed and the case has been voided from the record.\n` +
              (inviteUrl ? `\n**Rejoin the server:** ${inviteUrl}` : ""),
            footer: `Reviewed by ${i.user.tag}`,
          })],
        }).catch(() => {});
      }
    }
  } else {
    // Rejected — DM the user
    const user = await i.client.users.fetch(appeal.user_id).catch(() => null);
    if (user) {
      user.send({
        embeds: [errorEmbed(
          "Your Appeal Was Rejected",
          `Your appeal for **Case #${appeal.case_number}** (${appeal.punishment_type}) has been **rejected**.\nThe original punishment remains in place.`,
        )],
      }).catch(() => {});
    }
  }
}