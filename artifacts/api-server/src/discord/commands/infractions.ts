import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { isManager } from "../utils/staffPerms";
import {
  getProfile,
  recordInfraction,
  removeInfraction,
  activeStrikes,
  syncProfileFromMember,
  type InfractionType,
} from "../storage/staff";
import { getGuildConfig, getInfractionsConfig } from "../storage/config";
import { buildStaffEmbed } from "../utils/staffEmbed";
import { autoDemoteForActiveStrikes } from "../utils/staffActions";
import { buildBullets, CE, COLORS, prettyEmbed } from "../utils/embedStyle";

const TYPE_CHOICES = [
  { name: "Warning", value: "warning" as const },
  { name: "Strike (expires in 14 days)", value: "strike" as const },
  { name: "Demotion (manual log)", value: "demotion" as const },
  { name: "Termination (manual log)", value: "termination" as const },
];

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("infractions")
    .setDescription("Manage infractions on a staff profile.")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("View a staff member's infractions.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Staff member").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add an infraction to a staff profile.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Staff member").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Infraction type")
            .setRequired(true)
            .addChoices(...TYPE_CHOICES),
        )
        .addStringOption((o) =>
          o.setName("reason").setDescription("Reason").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove an infraction by id.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Staff member").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("infraction-id")
            .setDescription("Infraction id (from /infractions view)")
            .setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand(true);
    const target = interaction.options.getUser("user", true);

    if (sub === "view") {
      const profile = await getProfile(interaction.guildId, target.id);
      const infractions = profile?.infractions ?? [];
      const sorted = [...infractions].sort((a, b) => b.at - a.at);
      const lines = sorted.slice(0, 15).map((inf) => {
        const expired = inf.expiresAt && inf.expiresAt < Date.now();
        const exp = inf.expiresAt
          ? expired
            ? " *(expired)*"
            : ` *(expires <t:${Math.floor(inf.expiresAt / 1000)}:R>)*`
          : "";
        return `• \`${inf.id}\` **${inf.type}** — ${inf.reason}\n   by <@${inf.byUserId}> <t:${Math.floor(inf.at / 1000)}:R>${exp}`;
      });
      const active = activeStrikes(infractions);
      const embed = buildStaffEmbed({
        title: "Infractions",
        target,
        description: lines.length > 0 ? lines.join("\n\n") : "*No infractions.*",
        color: 0xfaa61a,
        footer: `Active strikes: ${active.length} • Total entries: ${infractions.length}`,
      });
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (!(await isManager(interaction))) {
      await interaction.reply({
        content: "You aren't allowed to manage infractions.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "add") {
      const type = interaction.options.getString("type", true) as InfractionType;
      const reason = interaction.options.getString("reason", true);
      const member = await interaction.guild.members
        .fetch(target.id)
        .catch(() => null);
      if (member) await syncProfileFromMember(interaction.guildId, member);
      const inf = await recordInfraction(
        interaction.guildId,
        target.id,
        type,
        interaction.user.id,
        reason,
      );
      const cfg = await getGuildConfig(interaction.guildId);
      const infractionCfg = getInfractionsConfig(cfg);
      if (infractionCfg.dmOnInfraction) {
        const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
        target.send({
          embeds: [prettyEmbed({
            title: `Staff infraction logged: ${typeLabel}`,
            description: `${CE.warning.str}\n\n${buildBullets([
              { label: "Server", value: interaction.guild.name },
              { label: "Type", value: typeLabel },
              { label: "Reason", value: reason },
              { label: "Issued by", value: interaction.user.tag },
              ...(inf.expiresAt ? [{ label: "Expires", value: `<t:${Math.floor(inf.expiresAt / 1000)}:R>` }] : []),
            ])}`,
            thumbnail: target.displayAvatarURL({ size: 256 }),
            color: type === "termination" ? COLORS.danger : type === "strike" ? COLORS.warning : COLORS.info,
            footer: `Infraction ${inf.id} • Zenvy`,
          })],
        }).catch(() => {});
      }
      const embed = buildStaffEmbed({
        title: `${CE.warning.str} Infraction logged: ${type}`,
        target,
        color:
          type === "termination"
            ? 0xed4245
            : type === "strike"
              ? 0xeb459e
              : type === "warning"
                ? 0xfaa61a
                : 0x2b2d31,
        fields: [
          { name: "Reason", value: reason, inline: false },
          { name: "Issued by", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Id", value: `\`${inf.id}\``, inline: true },
          ...(inf.expiresAt
            ? [
                {
                  name: "Expires",
                  value: `<t:${Math.floor(inf.expiresAt / 1000)}:R>`,
                  inline: true,
                },
              ]
            : []),
        ],
      });
      await interaction.reply({ embeds: [embed] });

      // 3 active strikes => auto-demotion (mirrored to the connected server).
      if (type === "strike" && member) {
        const result = await autoDemoteForActiveStrikes(
          interaction.client,
          interaction.guild,
          member,
          interaction.user.id,
          `Triggered by strike ${inf.id}.`,
        );
        if (result.triggered) {
          const autoEmbed = buildStaffEmbed({
            title: result.isTermination
              ? `${CE.termination.str} Auto-Termination (3 strikes)`
              : `${CE.demotion.str} Auto-Demotion (3 strikes)`,
            target,
            color: result.isTermination ? 0xed4245 : 0xfaa61a,
            fields: [
              {
                name: "From",
                value: result.fromRoleId ? `<@&${result.fromRoleId}>` : "*unknown*",
                inline: true,
              },
              {
                name: "To",
                value: result.toRoleId
                  ? `<@&${result.toRoleId}>`
                  : "*Terminated — all staff roles removed*",
                inline: true,
              },
              {
                name: "Strikes cleared",
                value: String(result.clearedStrikes ?? 0),
                inline: true,
              },
              ...(result.otherGuildId
                ? [
                    {
                      name: "Connected server",
                      value: result.propagated
                        ? `${CE.success.str} Mirrored to \`${result.otherGuildId}\``
                        : `${CE.warning.str} ${result.propagationNote ?? "Not mirrored"}`,
                      inline: false,
                    },
                  ]
                : []),
            ],
            footer: "Active strike chain reset after escalation.",
          });
          await interaction.followUp({ embeds: [autoEmbed] }).catch(() => {});
        }
      }
      return;
    }

    if (sub === "remove") {
      const id = interaction.options.getString("infraction-id", true);
      const removed = await removeInfraction(interaction.guildId, target.id, id);
      if (!removed) {
        await interaction.reply({
          content: `No infraction with id \`${id}\` on that profile.`,
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(
        `${CE.success.str} Removed infraction \`${id}\` (${removed.type}) from <@${target.id}>.`,
      );
      return;
    }
  },
};

export default command;
