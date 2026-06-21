import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed, successEmbed, infoEmbed } from "../utils/embedStyle";
import { addNote, getNotes, deleteNote } from "../storage/notes";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("note")
    .setDescription("Private staff notes about a user.")
    .addSubcommand(sub => sub
      .setName("add")
      .setDescription("Add a note about a user.")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
      .addStringOption(o => o.setName("note").setDescription("Note content").setRequired(true).setMaxLength(1000))
    )
    .addSubcommand(sub => sub
      .setName("list")
      .setDescription("View notes about a user.")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName("delete")
      .setDescription("Delete a note by its ID.")
      .addStringOption(o => o.setName("id").setDescription("Note ID (from /note list)").setRequired(true))
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "note"))) return;
    if (!interaction.guildId) return;

    const sub = interaction.options.getSubcommand();

    if (sub === "add") {
      const target = interaction.options.getUser("user", true);
      const text = interaction.options.getString("note", true);
      const entry = await addNote(interaction.guildId, target.id, text, interaction.user.tag);
      await interaction.reply({
        embeds: [prettyEmbed({
          title: "Note added",
          description: `${CE.information.str}\n\n${buildBullets([
            { label: "User", value: `<@${target.id}> — ${target.tag}` },
            { label: "Note", value: text },
            { label: "ID",   value: `\`${entry.id}\`` },
          ])}`,
          thumbnail: target.displayAvatarURL({ size: 256 }),
          color: COLORS.info,
          footer: "Only visible to staff",
        })],
        flags: 1 << 6,
      });

    } else if (sub === "list") {
      const target = interaction.options.getUser("user", true);
      const notes = await getNotes(interaction.guildId, target.id);
      if (notes.length === 0) {
        await interaction.reply({ embeds: [infoEmbed("No notes", `No notes for **${target.tag}**.`)] , flags: 1 << 6 });
        return;
      }
      const lines = notes.map(n =>
        `• \`${n.id}\` — ${n.note.slice(0, 80)}${n.note.length > 80 ? "…" : ""}\n  *by ${n.addedBy} • <t:${Math.floor(n.addedAt / 1000)}:R>*`
      );
      await interaction.reply({
        embeds: [prettyEmbed({
          title: `Notes — ${target.tag}`,
          description: lines.join("\n\n"),
          thumbnail: target.displayAvatarURL({ size: 256 }),
          color: COLORS.info,
          footer: `${notes.length} note${notes.length === 1 ? "" : "s"} • use /note delete <id> to remove`,
        })],
        flags: 1 << 6,
      });

    } else if (sub === "delete") {
      const id = interaction.options.getString("id", true);
      const ok = await deleteNote(interaction.guildId, id);
      if (!ok) {
        await interaction.reply({ embeds: [errorEmbed("Not found", `No note with ID \`${id}\` exists.`)] , flags: 1 << 6 });
        return;
      }
      await interaction.reply({ embeds: [successEmbed("Note deleted", `Note \`${id}\` removed.`)] , flags: 1 << 6 });
    }
  },
};

export default command;