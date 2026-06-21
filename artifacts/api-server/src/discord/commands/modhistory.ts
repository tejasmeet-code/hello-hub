import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, infoEmbed } from "../utils/embedStyle";
import { listCases } from "../storage/cases";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("modhistory")
    .setDescription("View cases issued by a specific moderator.")
    .addUserOption(o => o.setName("moderator").setDescription("Moderator to look up (defaults to yourself)").setRequired(false))
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "modhistory"))) return;
    if (!interaction.guildId) return;

    const target = interaction.options.getUser("moderator") ?? interaction.user;
    await interaction.deferReply({ flags: 1 << 6 });

    const all = await listCases(interaction.guildId);
    const modCases = all.filter(c => c.moderator_id === target.id);

    if (modCases.length === 0) {
      await interaction.editReply({ embeds: [infoEmbed("No history", `**${target.tag}** has no recorded actions in this server.`)] });
      return;
    }

    const counts: Record<string, number> = {};
    for (const c of modCases) counts[c.action] = (counts[c.action] ?? 0) + 1;
    const summary = Object.entries(counts).map(([k, v]) => `${k}: **${v}**`).join(" • ");

    const lines = modCases.slice(0, 20).map(c =>
      `• \`#${c.case_number}\` **${c.action.toUpperCase()}** → <@${c.target_id}> — ${c.reason.slice(0, 50)}${c.reason.length > 50 ? "…" : ""}`
    );

    await interaction.editReply({
      embeds: [prettyEmbed({
        title: `Mod history — ${target.tag}`,
        description: `${buildBullets([{ label: "Summary", value: summary }])}\n\n${lines.join("\n")}`,
        thumbnail: target.displayAvatarURL({ size: 256 }),
        color: COLORS.staff,
        footer: `${modCases.length} total • showing ${Math.min(modCases.length, 20)} • Relosta Bot`,
      })],
    });
  },
};

export default command;