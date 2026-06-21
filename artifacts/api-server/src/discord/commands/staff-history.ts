import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  getProfile,
  listStaffRoles,
  syncProfileFromMember,
} from "../storage/staff";
import { buildStaffEmbed } from "../utils/staffEmbed";
import { CE } from "../utils/embedStyle";

function fmtDate(ts: number): string {
  return `<t:${Math.floor(ts / 1000)}:d>`;
}

function describeRole(roleId: string | null, names: Map<string, string>): string {
  if (!roleId) return "_no role_";
  return names.get(roleId) ?? `<@&${roleId}>`;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("staff-history")
    .setDescription("Show a staff member's full promotion / demotion timeline.")
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName("user").setDescription("Staff member (defaults to you)"),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", flags: 1 << 6 });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    const target = interaction.options.getUser("user", false) ?? interaction.user;
    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);
    if (member) await syncProfileFromMember(interaction.guildId, member);

    const profile = await getProfile(interaction.guildId, target.id);
    if (!profile) {
      await interaction.editReply({
        content: `<@${target.id}> has no staff history yet.`,
        allowedMentions: { users: [] },
      });
      return;
    }

    const roleEntries = await listStaffRoles(interaction.guildId);
    const roleNames = new Map<string, string>();
    for (const r of roleEntries) {
      const role = await interaction.guild.roles.fetch(r.roleId).catch(() => null);
      roleNames.set(r.roleId, role ? role.name : `<@&${r.roleId}>`);
    }

    type Event = { at: number; line: string };
    const events: Event[] = [];

    events.push({
      at: profile.firstJoinedAt,
      line: `${CE.success.str} First joined staff — ${fmtDate(profile.firstJoinedAt)}`,
    });

    for (const p of profile.promotions) {
      events.push({
        at: p.at,
        line: `${CE.promotion.str} Promoted from **${describeRole(p.fromRoleId, roleNames)}** → **${describeRole(p.toRoleId, roleNames)}** by <@${p.byUserId}>${p.reason ? ` · _${p.reason}_` : ""}`,
      });
    }
    for (const d of profile.demotions) {
      const tgt = d.toRoleId
        ? `**${describeRole(d.toRoleId, roleNames)}**`
        : "**TERMINATED**";
      events.push({
        at: d.at,
        line: `${CE.demotion.str} Demoted from **${describeRole(d.fromRoleId, roleNames)}** → ${tgt} by <@${d.byUserId}>${d.reason ? ` · _${d.reason}_` : ""}`,
      });
    }
    if (profile.terminated && profile.terminatedAt) {
      events.push({
        at: profile.terminatedAt,
        line: `${CE.termination.str} Terminated — ${fmtDate(profile.terminatedAt)}`,
      });
    }

    events.sort((a, b) => a.at - b.at);

    let body =
      events.length === 0
        ? "_No timeline events recorded._"
        : events.map((e) => `• ${e.line}`).join("\n");

    if (body.length > 3900) body = body.slice(0, 3900) + "\n…(truncated)";

    const fields = [
      {
        name: "Current role",
        value: profile.terminated
          ? `${CE.termination.str} Terminated`
          : describeRole(profile.currentRoleId, roleNames),
        inline: true,
      },
      {
        name: "Promotions",
        value: String(profile.promotions.length),
        inline: true,
      },
      {
        name: "Demotions",
        value: String(profile.demotions.length),
        inline: true,
      },
    ];

    const embed = buildStaffEmbed({
      title: "Staff History",
      target,
      color: 0x5865f2,
      fields,
      description: body,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;