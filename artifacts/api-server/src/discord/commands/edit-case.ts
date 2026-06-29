import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getCase, editCase } from "../storage/cases";
import { ensureWhitelisted } from "../utils/gate";
import { successEmbed, errorEmbed, COLORS, prettyEmbed } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("edit-case")
    .setDescription("Edit or void a moderation case.")
    .addIntegerOption((o) =>
      o.setName("case_number").setDescription("The case number to edit").setRequired(true).setMinValue(1),
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("New reason for the case").setRequired(false).setMaxLength(512),
    )
    .addBooleanOption((o) =>
      o.setName("void").setDescription("Mark this case as void/inactive").setRequired(false),
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "edit-case"))) return;
    if (!interaction.guildId) return;

    await interaction.deferReply();

    const caseNumber = interaction.options.getInteger("case_number", true);
    const newReason = interaction.options.getString("reason");
    const voidCase = interaction.options.getBoolean("void") ?? false;

    const existing = await getCase(interaction.guildId, caseNumber);
    if (!existing) {
      await interaction.editReply({
        embeds: [errorEmbed(`Case #${caseNumber} not found`, "That case number doesn't exist in this server.")],
      });
      return;
    }

    const updates: { reason?: string; active?: boolean } = {};
    if (newReason) updates.reason = newReason;
    if (voidCase) updates.active = false;

    if (Object.keys(updates).length === 0) {
      await interaction.editReply({
        embeds: [
          prettyEmbed({
            title: `Case #${caseNumber} — ${existing.action}`,
            color: COLORS.info,
            fields: [
              { name: "Target", value: `<@${existing.target_id}>`, inline: true },
              { name: "Moderator", value: `<@${existing.moderator_id}>`, inline: true },
              { name: "Status", value: existing.active ? "Active" : "Void", inline: true },
              { name: "Reason", value: existing.reason, inline: false },
              ...(existing.proof ? [{ name: "Proof", value: existing.proof, inline: false }] : []),
            ],
            footer: `Created ${new Date(existing.created_at).toUTCString()}`,
          }),
        ],
      });
      return;
    }

    const updated = await editCase(interaction.guildId, caseNumber, updates);
    if (!updated) {
      await interaction.editReply({
        embeds: [errorEmbed("Update failed", "Could not update that case.")],
      });
      return;
    }

    const changes: string[] = [];
    if (newReason) changes.push(`**Reason:** ${newReason}`);
    if (voidCase) changes.push("**Status:** Voided");

    await interaction.editReply({
      embeds: [successEmbed(`Case #${caseNumber} updated`, changes.join("\n"))],
    });
  },
};

export default command;