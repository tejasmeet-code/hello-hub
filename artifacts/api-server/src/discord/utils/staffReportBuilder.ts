import { EmbedBuilder, type Client, type Guild } from "discord.js";
import {
  getActiveInfractions,
  listAllProfiles,
  listStaffRoles,
  syncProfileFromMember,
  type StaffProfile,
} from "../storage/staff";
import { getQuota, type QuotaConfigLike } from "../storage/quota";
import { getGuildConfig } from "../storage/config";
import { CE } from "./embedStyle";

interface StaffRow {
  userId: string;
  positionLabel: string;
  positionRank: number;
  promotions: number;
  demotions: number;
  warnings: number;
  strikes: number;
  fulfilledWeeks: number;
  terminated: boolean;
  score: number;
}

export const SCORE = {
  promotion: 4,
  fulfilledWeek: 1,
  warning: -1,
  strike: -2,
  demotion: -3,
  termination: -6,
} as const;

function calcScore(r: Omit<StaffRow, "score">): number {
  let s = 0;
  s += r.promotions * SCORE.promotion;
  s += r.fulfilledWeeks * SCORE.fulfilledWeek;
  s += r.warnings * SCORE.warning;
  s += r.strikes * SCORE.strike;
  s += r.demotions * SCORE.demotion;
  if (r.terminated) s += SCORE.termination;
  return s;
}

type Tier = "S" | "A" | "B" | "C" | "D" | "F";

function tierOf(score: number, terminated: boolean): Tier {
  if (terminated) return "F";
  if (score >= 10) return "S";
  if (score >= 5) return "A";
  if (score >= 2) return "B";
  if (score >= -1) return "C";
  if (score >= -5) return "D";
  return "F";
}

const TIERS: { key: Tier; label: string; emoji: string }[] = [
  { key: "S", label: "Elite",           emoji: CE.success.str     },
  { key: "A", label: "Excellent",       emoji: CE.promotion.str   },
  { key: "B", label: "Reliable",        emoji: CE.staff.str       },
  { key: "C", label: "Average",         emoji: CE.information.str },
  { key: "D", label: "Underperforming", emoji: CE.warning.str     },
  { key: "F", label: "At risk",         emoji: CE.termination.str },
];

function formatLine(r: StaffRow): string {
  const tag = `<@${r.userId}>`;
  const role = r.positionLabel;
  const stats =
    `${CE.promotion.str}${r.promotions} ` +
    `${CE.demotion.str}${r.demotions} ` +
    `${CE.warning.str}${r.warnings} ` +
    `${CE.termination.str}${r.strikes}`;
  return `${tag} · ${role} · ${stats} · **${r.score}**`;
}

async function buildRow(
  guildId: string,
  p: StaffProfile,
  posMap: Map<string, number>,
  labelMap: Map<string, string>,
): Promise<StaffRow> {
  const now = Date.now();
  const active = getActiveInfractions(p, undefined, now);
  const warnings = active.filter((i) => i.type === "warning").length;
  const strikes = active.filter((i) => i.type === "strike").length;

  const positionLabel = p.currentRoleId
    ? (labelMap.get(p.currentRoleId) ?? "Unknown role")
    : p.terminated
      ? "Terminated"
      : "No role";
  const positionRank = p.currentRoleId
    ? (posMap.get(p.currentRoleId) ?? 999)
    : 999;

  const q = await getQuota(guildId, p.userId);
  const fulfilledWeeks = q.weekly.filter((w) => w.fulfilled).length;

  const base: Omit<StaffRow, "score"> = {
    userId: p.userId,
    positionLabel,
    positionRank,
    promotions: p.promotions.length,
    demotions: p.demotions.length,
    warnings,
    strikes,
    fulfilledWeeks,
    terminated: p.terminated,
  };
  return { ...base, score: calcScore(base) };
}

export type BuildStaffReportResult =
  | { ok: true; embed: EmbedBuilder }
  | { ok: false; reason: "no-roles" | "no-guild" };

export async function buildStaffReportEmbed(
  client: Client,
  guildId: string,
): Promise<BuildStaffReportResult> {
  const guild: Guild | null =
    client.guilds.cache.get(guildId) ??
    (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return { ok: false, reason: "no-guild" };

  const cfg = await getGuildConfig(guildId);
  const quotaCfg: QuotaConfigLike | null = cfg.quotaConfig ?? null;

  const roleEntries = await listStaffRoles(guildId);
  if (roleEntries.length === 0) return { ok: false, reason: "no-roles" };
  const staffRoleIds = new Set(roleEntries.map((r) => r.roleId));

  const members = await guild.members.fetch().catch(() => null);
  if (members) {
    for (const m of members.values()) {
      if (m.user.bot) continue;
      if (![...m.roles.cache.keys()].some((id) => staffRoleIds.has(id))) continue;
      await syncProfileFromMember(guildId, m).catch(() => {});
    }
  }

  const positionByRoleId = new Map<string, number>();
  const labelByRoleId = new Map<string, string>();
  for (const r of roleEntries) {
    positionByRoleId.set(r.roleId, r.position);
    const role = await guild.roles.fetch(r.roleId).catch(() => null);
    labelByRoleId.set(r.roleId, role ? role.name : `Position #${r.position}`);
  }

  const profiles = await listAllProfiles(guildId);
  const rows: StaffRow[] = [];
  for (const p of profiles) {
    rows.push(await buildRow(guildId, p, positionByRoleId, labelByRoleId));
  }

  const tiers: Record<Tier, StaffRow[]> = { S: [], A: [], B: [], C: [], D: [], F: [] };
  for (const r of rows) tiers[tierOf(r.score, r.terminated)]!.push(r);
  for (const k of Object.keys(tiers) as Tier[]) {
    tiers[k].sort((a, b) => b.score - a.score || a.positionRank - b.positionRank);
  }

  const totalScored = rows.length;
  const description =
    `**${totalScored}** staff scored. Higher = better.\n` +
    `Score = **+${SCORE.promotion}** per promotion, **+${SCORE.fulfilledWeek}** per fulfilled quota week, ` +
    `**${SCORE.warning}** warning, **${SCORE.strike}** strike, **${SCORE.demotion}** demotion, **${SCORE.termination}** termination.`;

  const embed = new EmbedBuilder()
    .setTitle(`Staff Tier Report — ${guild.name}`)
    .setColor(0xfee75c)
    .setDescription(description)
    .setTimestamp(new Date());
  const icon = guild.iconURL({ size: 256 });
  if (icon) embed.setThumbnail(icon);

  for (const tier of TIERS) {
    const list = tiers[tier.key];
    const fieldName = `${tier.emoji} ${tier.key} — ${tier.label} — ${list.length}`;
    if (list.length === 0) {
      embed.addFields({ name: fieldName, value: "—", inline: false });
      continue;
    }
    const lines = list.slice(0, 12).map((r) => formatLine(r));
    let value = lines.join("\n");
    if (list.length > 12) value += `\n…and **${list.length - 12}** more`;
    if (value.length > 1024) value = value.slice(0, 1010) + "\n…(truncated)";
    embed.addFields({ name: fieldName, value, inline: false });
  }

  embed.setFooter({
    text: quotaCfg
      ? `Weekly quota: ${quotaCfg.messages} msgs / ${quotaCfg.modActions} mod actions`
      : "No quota configured — set one with /config → Quota.",
  });

  return { ok: true, embed };
}