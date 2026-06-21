import type { User } from "discord.js";
import { prettyEmbed, buildBullets, COLORS, CE } from "./embedStyle";

export type StaffDMAction =
  | "promotion"
  | "demotion"
  | "termination"
  | "strike"
  | "warning";

const ACTION_COLORS: Record<StaffDMAction, number> = {
  promotion:   COLORS.success,
  demotion:    COLORS.warning,
  termination: COLORS.danger,
  strike:      0xeb459e,
  warning:     0xfaa61a,
};

// Titles: plain text only — custom emojis do NOT render in embed titles
const ACTION_TITLES: Record<StaffDMAction, string> = {
  promotion:   "You have been promoted!",
  demotion:    "You have been demoted.",
  termination: "You have been terminated.",
  strike:      "You have received a strike.",
  warning:     "You have received a warning.",
};

// Emojis go in the description where they DO render
const ACTION_EMOJIS: Record<StaffDMAction, string> = {
  promotion:   CE.promotion.str,
  demotion:    CE.demotion.str,
  termination: CE.termination.str,
  strike:      CE.warning.str,
  warning:     CE.warning.str,
};

/**
 * Send a staff action DM to the affected staff member.
 * Returns true if delivered, false if DMs are closed/failed.
 */
export async function sendStaffDM(
  target: User,
  opts: {
    action: StaffDMAction;
    serverName: string;
    reason: string;
    byTag: string;
    fromRole?: string;
    toRole?: string;
    expiresAt?: number | null;
  },
): Promise<boolean> {
  const bulletItems: { label: string; value: string }[] = [
    { label: "Server",    value: `**${opts.serverName}**` },
    { label: "Issued by", value: opts.byTag },
    { label: "Reason",    value: opts.reason || "No reason provided." },
  ];

  if (opts.fromRole) bulletItems.push({ label: "Previous role", value: opts.fromRole });
  if (opts.toRole)   bulletItems.push({ label: "New role",      value: opts.toRole });
  if (opts.expiresAt) {
    bulletItems.push({
      label: "Expires",
      value: `<t:${Math.floor(opts.expiresAt / 1000)}:R>`,
    });
  }

  const emoji = ACTION_EMOJIS[opts.action];
  const embed = prettyEmbed({
    title:       ACTION_TITLES[opts.action],
    description: `${emoji}\n\n${buildBullets(bulletItems)}`,
    thumbnail:   target.displayAvatarURL({ size: 256 }),
    color:       ACTION_COLORS[opts.action],
    footer:      "If you believe this is a mistake, please contact management.",
  });

  try {
    await target.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}