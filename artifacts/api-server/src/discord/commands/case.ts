import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed, infoEmbed } from "../utils/embedStyle";
import { getCase, listCases } from "../storage/cases";

const ACTION_COLORS: Record<string, number> = {
  ban:          COLORS.danger,
  unban:        COLORS.success,
  mute:         COLORS.warning,
  unmute:       COLORS.success,
  warn:         COLORS.warning,
  jail:         COLORS.neutral,
  kick:         COLORS.danger,
  "ban-request": COLORS.danger,
};

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("case")
    .setDescription("Look up moderation cases.")
    .addSubcommand(sub => sub
      .setName("view")
      .setDescription("View a specific case by number.")
      .addIntegerOption(o => o.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))
    )
    .addSubcommand(sub => sub
      .setName("list")
      .setDescription("List recent cases for a user.")
      .addUserOption(o => o.setName("user").setDescription("User to look up").setRequired(true))
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "case"))) return;
    if (!interaction.guildId) return;

    await interaction.deferReply({ flags: 1 << 6 });

    const sub = interaction.options.getSubcommand();

    if (sub === "view") {
      const caseNumber = interaction.options.getInteger("number", true);
      const c = await getCase(interaction.guildId, caseNumber);
      if (!c) {
        await interaction.editReply({ embeds: [errorEmbed(`Case #${caseNumber} not found`, "That case doesn't exist in this server.")] });
        return;
      }
      await interaction.editReply({
        embeds: [prettyEmbed({
          title: `Case #${c.case_number} — ${c.action.toUpperCase()}`,
          description: buildBullets([
            { label: "Target",    value: `<@${c.target_id}>` },
            { label: "Moderator", value: `<@${c.moderator_id}>` },
            { label: "Status",    value: c.active ? `${CE.success.str} Active` : `${CE.error.str} Void` },
            { label: "Reason",    value: c.reason },
            ...(c.proof ? [{ label: "Proof", value: c.proof }] : []),
          ]),
          color: ACTION_COLORS[c.action] ?? COLORS.neutral,
          footer: `Created ${new Date(c.created_at).toUTCString()} • Case #${c.case_number} • Relosta Bot`,
        })],
      });

    } else if (sub === "list") {
      const target = interaction.options.getUser("user", true);
      const cases = await listCases(interaction.guildId, target.id);
      if (cases.length === 0) {
        await interaction.editReply({ embeds: [infoEmbed("No cases", `**${target.tag}** has no cases in this server.`)] });
        return;
      }
      const lines = cases.slice(0, 20).map(c =>
        `• \`#${c.case_number}\` **${c.action.toUpperCase()}** — ${c.reason.slice(0, 60)}${c.reason.length > 60 ? "…" : ""} ${c.active ? "" : "*(void)*"}`
      );
      await interaction.editReply({
        embeds: [prettyEmbed({
          title: `Cases — ${target.tag}`,
          description: lines.join("\n"),
          thumbnail: target.displayAvatarURL({ size: 256 }),
          color: COLORS.info,
          footer: `${cases.length} total • showing ${Math.min(cases.length, 20)} • Relosta Bot`,
        })],
      });
    }
  },
};

export default command;