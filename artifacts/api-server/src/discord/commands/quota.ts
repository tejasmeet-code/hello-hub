import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { isManager } from "../utils/staffPerms";
import { getGuildConfig } from "../storage/config";
import {
  getCurrentWeek,
  getRecentWeeks,
  resolveQuotaStatus,
} from "../storage/quota";
import { buildStaffEmbed } from "../utils/staffEmbed";
import { listStaffRoles, syncProfileFromMember } from "../storage/staff";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("quota")
    .setDescription("Inspect weekly quota progress.")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("View a staff member's quota status.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Staff member (defaults to you)"),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("server")
        .setDescription("View this week's quota standings for all staff."),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", ephemeral: true });
      return;
    }
    const cfg = await getGuildConfig(interaction.guildId);
    if (!cfg.quotaConfig) {
      await interaction.reply({
        content:
          "Quota isn't configured. Set it with `/config quota set` first.",
        ephemeral: true,
      });
      return;
    }
    const sub = interaction.options.getSubcommand(true);

    if (sub === "view") {
      const target =
        interaction.options.getUser("user", false) ?? interaction.user;
      const week = await getCurrentWeek(
        interaction.guildId,
        target.id,
        cfg.quotaConfig.weekStartDay,
      );
      const recent = await getRecentWeeks(interaction.guildId, target.id, 4);
      const status = await resolveQuotaStatus(
        interaction.guildId,
        target.id,
        cfg.quotaConfig,
      );

      const recentLines = recent
        .filter((w) => w.weekStart !== week.weekStart)
        .slice(0, 3)
        .map((w) => {
          const ok =
            w.messages >= cfg.quotaConfig!.messages &&
            w.modActions >= cfg.quotaConfig!.modActions;
          return `• <t:${Math.floor(w.weekStart / 1000)}:D> — msgs **${w.messages}**, mod **${w.modActions}** ${ok ? `${CE.success.str}` : `${CE.error.str}`}`;
        });

      const embed = buildStaffEmbed({
        title: `${CE.information.str} Quota Status`,
        target,
        color: status.metThisWeek ? 0x57f287 : 0xfaa61a,
        fields: [
          {
            name: "This week",
            value:
              `Messages: **${week.messages}** / ${cfg.quotaConfig.messages}\n` +
              `Mod actions: **${week.modActions}** / ${cfg.quotaConfig.modActions}\n` +
              `Status: ${status.metThisWeek ? `${CE.success.str} on track` : `${CE.error.str} behind`}`,
            inline: false,
          },
          {
            name: "Consecutive missed weeks",
            value: String(status.consecutiveMissed),
            inline: true,
          },
          {
            name: "Next escalation if missed again",
            value: status.nextAction,
            inline: true,
          },
          ...(recentLines.length > 0
            ? [
                {
                  name: "Recent weeks",
                  value: recentLines.join("\n"),
                  inline: false,
                },
              ]
            : []),
        ],
      });
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === "server") {
      if (!(await isManager(interaction))) {
        await interaction.reply({
          content: "Only managers can see the full server roster.",
          ephemeral: true,
        });
        return;
      }
      await interaction.deferReply();
      const roles = await listStaffRoles(interaction.guildId);
      const members = await interaction.guild.members.fetch().catch(() => null);
      if (!members) {
        await interaction.editReply(
          "Couldn't fetch members. Enable the Server Members Intent.",
        );
        return;
      }
      const staffMembers = members.filter(
        (m) => !m.user.bot && roles.some((r) => m.roles.cache.has(r.roleId)),
      );

      const rows: string[] = [];
      let met = 0;
      for (const m of staffMembers.values()) {
        await syncProfileFromMember(interaction.guildId, m);
        const w = await getCurrentWeek(
          interaction.guildId,
          m.id,
          cfg.quotaConfig.weekStartDay,
        );
        const ok =
          w.messages >= cfg.quotaConfig.messages &&
          w.modActions >= cfg.quotaConfig.modActions;
        if (ok) met++;
        rows.push(
          `${ok ? `${CE.success.str}` : `${CE.error.str}`} <@${m.id}> — msgs **${w.messages}/${cfg.quotaConfig.messages}**, mod **${w.modActions}/${cfg.quotaConfig.modActions}**`,
        );
      }
      const embed = {
        title: `${CE.information.str} Weekly Quota — ${interaction.guild.name}`,
        description: rows.length > 0 ? rows.slice(0, 40).join("\n") : "*No staff members.*",
        color: 0x5865f2,
        footer: {
          text: `${met}/${staffMembers.size} on track this week`,
        },
        timestamp: new Date().toISOString(),
      };
      await interaction.editReply({ embeds: [embed] });
      return;
    }
  },
};

export default command;
