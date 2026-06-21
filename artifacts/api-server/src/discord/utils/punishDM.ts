import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type User,
} from "discord.js";
import { prettyEmbed, buildBullets, COLORS, CE } from "./embedStyle";
import { logger } from "../../lib/logger";
import type { CaseAction } from "../storage/cases";
import { logDmToWebhook } from "./dmWebhook";

const ACTION_LABELS: Partial<Record<CaseAction, string>> = {
  ban:   "Banned",
  mute:  "Muted",
  warn:  "Warned",
  jail:  "Jailed",
  kick:  "Kicked",
  unban: "Unbanned",
};

const ACTION_COLORS: Partial<Record<CaseAction, number>> = {
  ban:   COLORS.danger,
  mute:  COLORS.warning,
  warn:  COLORS.warning,
  jail:  COLORS.neutral,
  kick:  COLORS.danger,
  unban: COLORS.success,
};

const ACTION_EMOJI: Partial<Record<CaseAction, string>> = {
  ban:   CE.moderation.str,
  mute:  CE.moderation.str,
  warn:  CE.warning.str,
  jail:  CE.moderation.str,
  kick:  CE.moderation.str,
  unban: CE.success.str,
};

/**
 * Send a punishment DM to the target user. The appeal button is included only
 * when appeals are enabled and an appeals channel is configured.
 * Returns true if the DM was delivered, false if it failed.
 */
export async function sendPunishmentDM(
  target: User,
  opts: {
    action: CaseAction;
    serverName: string;
    reason: string;
    caseNumber: number;
    guildId: string;
    proof?: string | null;
    /** Invite URL for the appeal/support server — included in ban DMs. */
    appealServerInvite?: string | null;
    /** Whether to include the appeal modal button in the DM. */
    includeAppealButton?: boolean;
  },
): Promise<boolean> {
  const label = ACTION_LABELS[opts.action] ?? opts.action;
  const color = ACTION_COLORS[opts.action] ?? COLORS.neutral;
  const emoji = ACTION_EMOJI[opts.action] ?? CE.moderation.str;

  const bulletItems: { label: string; value: string }[] = [
    { label: "Server", value: `**${opts.serverName}**` },
    { label: "Case",   value: opts.caseNumber ? `\`#${opts.caseNumber}\`` : "N/A" },
    { label: "Reason", value: opts.reason },
  ];
  if (opts.proof) bulletItems.push({ label: "Proof", value: opts.proof });

  const appealButtonAllowed = Boolean(opts.includeAppealButton);
  let appealNote = "";
  if (opts.action === "ban") {
    if (opts.appealServerInvite) {
      appealNote = `\n\n${CE.information.str} **To appeal this ban**, join our appeal server and use \`/appeal\`:\n${opts.appealServerInvite}`;
    } else if (appealButtonAllowed) {
      appealNote = `\n\n${CE.information.str} Click the button below to appeal this punishment before leaving the server.`;
    }
  } else if (appealButtonAllowed) {
    appealNote = `\n\n${CE.information.str} Click the button below to appeal this punishment.`;
  }

  const embed = prettyEmbed({
    title:       `You have been ${label}`,
    description: `${emoji}\n\n${buildBullets(bulletItems)}${appealNote}`,
    thumbnail:   target.displayAvatarURL({ size: 256 }),
    color,
    footer: opts.caseNumber ? `Case #${opts.caseNumber} • Relosta Bot` : "Relosta Bot",
  });

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (appealButtonAllowed) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`appeal:dm:${opts.guildId}:${opts.caseNumber}`)
        .setLabel("Appeal this Punishment")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  if (opts.action === "ban" && opts.appealServerInvite) {
    row.addComponents(
      new ButtonBuilder()
        .setURL(opts.appealServerInvite)
        .setLabel("Join Appeal Server")
        .setStyle(ButtonStyle.Link),
    );
  }

  try {
    const dmChannel = await target.createDM();
    const components = row.components.length > 0 ? [row] : undefined;
    await dmChannel.send({ embeds: [embed], components });
    logger.debug({ userId: target.id, action: opts.action }, "punishDM: sent");
    // Log outgoing punishment DM to webhook
    await logDmToWebhook({
      direction: "out",
      userId: target.id,
      username: target.username,
      content: `[${label}] ${opts.serverName} — ${opts.reason}`,
    }).catch(() => {});
    return true;
  } catch (err) {
    logger.warn({ err, userId: target.id, action: opts.action }, "punishDM: failed to DM user");
    return false;
  }
}