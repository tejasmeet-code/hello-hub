import { logger } from "../../lib/logger";
import { CE } from "./embedStyle";

/**
 * Post a DM log entry to the MESSAGE_LOGS Discord webhook (if configured).
 *
 *   direction "in"  = a user sent a DM to the bot
 *   direction "out" = the bot sent a DM to a user (punishment, etc.)
 */
export async function logDmToWebhook(opts: {
  direction: "in" | "out";
  userId: string;
  username: string;
  content: string;
  attachments?: string[];
}): Promise<void> {
  const webhookUrl = process.env.MESSAGE_LOGS;
  if (!webhookUrl) return;

  const arrow = opts.direction === "in" ? CE.incoming.str : CE.outgoing.str;
  const label = opts.direction === "in" ? "User → Bot" : "Bot → User";

  const lines: string[] = [
    `**${arrow} DM | ${label}**`,
    `**User:** ${opts.username} (\`${opts.userId}\`)`,
    `**Message:** ${opts.content || "*(no text)*"}`,
  ];
  if (opts.attachments?.length) {
    lines.push(`**Attachments:** ${opts.attachments.join("  ")}`);
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: lines.join("\n"),
        username: "DM Logger",
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "MESSAGE_LOGS webhook post failed");
    }
  } catch (err) {
    logger.warn({ err }, "MESSAGE_LOGS webhook post error");
  }
}
