import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import type { SlashCommand } from "../types";
import { PERM_WHITELIST } from "../storage/whitelist";
import { COLORS, CE } from "../utils/embedStyle";
import { getCommands } from "../registry";

// Re-declare the exclusion set locally so bot-check can report excluded commands
// without coupling to registry internals.
const REGISTRATION_EXCLUDED: ReadonlySet<string> = new Set([
  "channel-shuffle","cursed-nicknames","emoji-channels","role-mystery",
  "role-rainbow","russianroulette","scramble-channels","scramble-roles",
  "slots","spooky","upside-down","wordscramble","trivia",
  "choice","coinflip","fortune","meme","randomcolor","rate","roll","rps",
  "tictactoe","wouldyourather",
]);

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("bot-check")
    .setDescription("Global-whitelist only: audits every registered bot command. [Dev only]")
    .setDMPermission(true),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({
        content: "This command is restricted to global-whitelist users.",
        flags: 1 << 6,
      });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    const all = getCommands();

    // Categorise every command
    const global: string[]            = [];
    const guild: string[]             = [];
    const handlerOnly: string[]       = [];
    const whitelistOnly: string[]     = [];
    const issues: string[]            = [];

    const seenNames = new Set<string>();
    for (const cmd of all) {
      const n = cmd.data.name;
      if (seenNames.has(n)) {
        issues.push(`**Duplicate name**: \`${n}\``);
      }
      seenNames.add(n);

      if ((cmd as any).globalWhitelistOnly) {
        whitelistOnly.push(n);
      } else if ((cmd as any).globalOnly) {
        global.push(n);
      } else if (REGISTRATION_EXCLUDED.has(n)) {
        handlerOnly.push(n);
      } else {
        guild.push(n);
      }
    }

    // Warn if guild commands would exceed Discord's 100-command limit
    if (guild.length > 100) {
      issues.push(`${CE.warning.str} **Guild command count** is **${guild.length}** — exceeds Discord's 100-command limit. Bulk registration will fail.`);
    }
    if (guild.length + global.length > 100) {
      issues.push(`${CE.warning.str} **Global command count** is **${global.length + guild.length}** (combined) — monitor for limit issues.`);
    }

    // Build summary embed
    const summary = new EmbedBuilder()
      .setColor(issues.length ? COLORS.warning : COLORS.success)
      .setTitle(`${CE.admin.str} Bot Command Audit`)
      .setDescription(
        issues.length
          ? `${CE.warning.str} **${issues.length} issue(s) detected**\n${issues.join("\n")}`
          : `${CE.success.str} All checks passed — no duplicate names or limit violations.`,
      )
      .addFields(
        { name: "Total commands in registry", value: `\`${all.length}\``, inline: true },
        { name: "Global-only", value: `\`${global.length}\``, inline: true },
        { name: "Guild-registered", value: `\`${guild.length}\` / 100`, inline: true },
        { name: "Handler-only (excluded)", value: `\`${handlerOnly.length}\``, inline: true },
        { name: "Global-whitelist-only", value: `\`${whitelistOnly.length}\``, inline: true },
        { name: "\u200b", value: "\u200b", inline: true },
      )
      .setFooter({ text: "Use /bot-check to re-run this audit any time." })
      .setTimestamp();

    // Detail embeds — one per category, split into fields of ≤15 commands each
    const detailEmbeds: EmbedBuilder[] = [];

    function addCategoryEmbeds(title: string, color: number, names: string[]) {
      if (!names.length) return;
      const pages = chunk(names, 15);
      pages.forEach((page, i) => {
        detailEmbeds.push(
          new EmbedBuilder()
            .setColor(color)
            .setTitle(pages.length > 1 ? `${title} (${i + 1}/${pages.length})` : title)
            .setDescription(page.map((n) => `\`/${n}\``).join("  ")),
        );
      });
    }

    addCategoryEmbeds(`${CE.admin.str} Global-only`, COLORS.primary, global);
    addCategoryEmbeds(`${CE.moderation.str} Guild-registered (${guild.length})`, COLORS.info, guild);
    addCategoryEmbeds(`${CE.settings.str} Handler-only / excluded`, COLORS.neutral, handlerOnly);
    addCategoryEmbeds(`${CE.staff.str} Global-whitelist-only`, COLORS.staff, whitelistOnly);

    // Discord allows max 10 embeds per message; send in batches
    const allEmbeds = [summary, ...detailEmbeds];
    const batches = chunk(allEmbeds, 10);

    await interaction.editReply({ embeds: batches[0] });
    for (let i = 1; i < batches.length; i++) {
      await interaction.followUp({ embeds: batches[i], flags: 1 << 6 });
    }
  },
};

export default command;
