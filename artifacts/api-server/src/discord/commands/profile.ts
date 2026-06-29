import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  activeStrikes,
  getProfile,
  listStaffRoles,
  syncProfileFromMember,
} from "../storage/staff";
import { getCurrentWeek } from "../storage/quota";
import { getGuildConfig } from "../storage/config";
import { buildStaffEmbed } from "../utils/staffEmbed";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View a staff member's complete profile.")
    .setDMPermission(false)
    .addUserOption((o) =>
      o.setName("user").setDescription("Staff member (defaults to you)"),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", ephemeral: true });
      return;
    }
    const target = interaction.options.getUser("user", false) ?? interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member) await syncProfileFromMember(interaction.guildId, member);

    const profile = await getProfile(interaction.guildId, target.id);
    const roles = await listStaffRoles(interaction.guildId);
    const cfg = await getGuildConfig(interaction.guildId);
    const week = await getCurrentWeek(
      interaction.guildId,
      target.id,
      cfg.quotaConfig?.weekStartDay ?? 0,
    );

    const heldEntry =
      member && roles.find((r) => member.roles.cache.has(r.roleId));
    const active = profile ? activeStrikes(profile.infractions) : [];
    const recentInfractions = profile
      ? [...profile.infractions].sort((a, b) => b.at - a.at).slice(0, 5)
      : [];
    const recentPromos = profile
      ? [...profile.promotions].sort((a, b) => b.at - a.at).slice(0, 3)
      : [];
    const recentDemos = profile
      ? [...profile.demotions].sort((a, b) => b.at - a.at).slice(0, 3)
      : [];

    const fields = [
      {
        name: "Current role",
        value: heldEntry
          ? `<@&${heldEntry.roleId}> (position **${heldEntry.position}**)`
          : "*not on staff*",
        inline: false,
      },
      {
        name: "Promotions",
        value: String(profile?.promotions.length ?? 0),
        inline: true,
      },
      {
        name: "Demotions",
        value: String(profile?.demotions.length ?? 0),
        inline: true,
      },
      {
        name: "Active strikes",
        value: `${active.length}${active.length > 0 ? ` ${CE.warning.str}` : ""}`,
        inline: true,
      },
      {
        name: "This week",
        value:
          `Messages: **${week.messages}**` +
          (cfg.quotaConfig ? ` / ${cfg.quotaConfig.messages}` : "") +
          ` • Mod actions: **${week.modActions}**` +
          (cfg.quotaConfig ? ` / ${cfg.quotaConfig.modActions}` : ""),
        inline: false,
      },
    ];
    if (recentPromos.length > 0) {
      fields.push({
        name: "Recent promotions",
        value: recentPromos
          .map(
            (p) =>
              `• <@&${p.toRoleId}> by <@${p.byUserId}> <t:${Math.floor(p.at / 1000)}:R>`,
          )
          .join("\n"),
        inline: false,
      });
    }
    if (recentDemos.length > 0) {
      fields.push({
        name: "Recent demotions",
        value: recentDemos
          .map(
            (d) =>
              `• ${d.toRoleId ? `to <@&${d.toRoleId}>` : "*terminated*"} by <@${d.byUserId}> <t:${Math.floor(d.at / 1000)}:R>`,
          )
          .join("\n"),
        inline: false,
      });
    }
    if (recentInfractions.length > 0) {
      fields.push({
        name: "Recent infractions",
        value: recentInfractions
          .map((i) => `• **${i.type}** — ${i.reason} *(by <@${i.byUserId}>)*`)
          .join("\n"),
        inline: false,
      });
    }

    const embed = buildStaffEmbed({
      title: `${CE.members.str} Staff Profile`,
      target,
      color: 0x2b2d31,
      fields,
      footer: profile
        ? `Joined staff <t:${Math.floor(profile.firstJoinedAt / 1000)}:D>`
        : "No staff record yet.",
    });
    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
