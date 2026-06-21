import type {
  ChatInputCommandInteraction,
  CommandInteractionOption,
} from "discord.js";
import { logger } from "../../lib/logger";
import { CE } from "./embedStyle";

const WEBHOOK_URL = process.env["DISCORD_WEBHOOK_URL_1"];

function describeOption(opt: CommandInteractionOption): string {
  if (opt.user) return `${opt.name}: <@${opt.user.id}>`;
  if (opt.role) return `${opt.name}: <@&${opt.role.id}>`;
  if (opt.channel) return `${opt.name}: <#${opt.channel.id}>`;
  if (opt.value !== undefined) {
    const v = String(opt.value);
    return `${opt.name}: ${v.length > 200 ? v.slice(0, 200) + "…" : v}`;
  }
  return opt.name;
}

function flattenOptions(
  opts: readonly CommandInteractionOption[] | undefined,
): string[] {
  if (!opts || opts.length === 0) return [];
  const out: string[] = [];
  for (const o of opts) {
    if (o.options && o.options.length > 0) {
      out.push(...flattenOptions(o.options));
    } else {
      out.push(describeOption(o));
    }
  }
  return out;
}

export interface AuditEvent {
  interaction: ChatInputCommandInteraction;
  status: "ok" | "error";
  errorMessage?: string;
}

export async function sendCommandAudit(event: AuditEvent): Promise<void> {
  if (!WEBHOOK_URL) return;
  const i = event.interaction;
  const cmd = `/${i.commandName}`;
  let sub = "";
  try {
    const subGroup = i.options.getSubcommandGroup(false);
    const subCmd = i.options.getSubcommand(false);
    if (subGroup) sub += ` ${subGroup}`;
    if (subCmd) sub += ` ${subCmd}`;
  } catch {
    // no subcommand — ignore
  }
  const args = flattenOptions(i.options.data);
  const where = i.guild
    ? `**${i.guild.name}** (\`${i.guild.id}\`)${i.channel && "name" in i.channel ? ` • #${i.channel.name}` : ""}`
    : "(DM)";
  const status = event.status === "ok" ? CE.success.str : CE.error.str;
  const lines = [
    `${status} \`${cmd}${sub}\` by **${i.user.tag}** (\`${i.user.id}\`)`,
    `${CE.location.str} ${where}`,
  ];
  if (args.length > 0) {
    lines.push(`${CE.attach.str} ${args.join(" • ")}`);
  }
  if (event.errorMessage) {
    lines.push(`${CE.warning.str} ${event.errorMessage.slice(0, 500)}`);
  }
  const payload = {
    content: lines.join("\n").slice(0, 1900),
    username: "Command Audit",
    avatar_url: i.client.user?.displayAvatarURL() ?? undefined,
    allowed_mentions: { parse: [] as string[] },
  };
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logger.warn({ err }, "Failed to send command audit webhook");
  }
}

export async function sendPlainAudit(content: string): Promise<void> {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content.slice(0, 1900),
        username: "Command Audit",
        allowed_mentions: { parse: [] as string[] },
      }),
    });
  } catch (err) {
    logger.warn({ err }, "Failed to send plain audit webhook");
  }
}
