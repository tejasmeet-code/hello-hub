import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { prettyEmbed, COLORS, CE } from "../utils/embedStyle";
import { readGuildCount } from "../storage/guild-counter";
import { PERM_WHITELIST } from "../storage/whitelist";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("servercount")
    .setDescription("[Dev] List all servers the bot is in with IDs and invite links.")
    .setDMPermission(true),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({ content: "This command is restricted to bot developers.", flags: 1 << 6 });
      return;
    }

    await interaction.deferReply({ flags: 1 << 6 });

    const guilds = interaction.client.guilds.cache;
    const allTime = await readGuildCount();

    const lines: string[] = [];
    for (const guild of guilds.values()) {
      // Try to create a permanent invite from any available text channel
      let inviteUrl = "N/A";
      try {
        const channels = guild.channels.cache.filter(
          (c) => c.isTextBased() && !c.isDMBased(),
        );
        const ch = channels.first();
        if (ch && ch.isTextBased() && !ch.isDMBased()) {
          const invite = await (ch as any).createInvite({
            maxAge: 0,
            maxUses: 0,
            unique: false,
            reason: "servercount command",
          });
          inviteUrl = invite.url;
        }
      } catch { /* no perms — leave as N/A */ }

      lines.push(`**${guild.name}** | ID: \`${guild.id}\` | ${inviteUrl}`);
    }

    const PAGE_SIZE = 20;
    const chunks: string[][] = [];
    for (let i = 0; i < lines.length; i += PAGE_SIZE) {
      chunks.push(lines.slice(i, i + PAGE_SIZE));
    }

    const header = prettyEmbed({
      title: "Server List",
      description:
        `${CE.information.str} **Currently in:** ${guilds.size} servers\n` +
        `**All-time joins:** ${allTime.toLocaleString()}\n\n` +
        (chunks[0]?.join("\n") ?? "No servers."),
      color: COLORS.info,
      footer: "Dev only • Relosta Bot",
    });

    await interaction.editReply({ embeds: [header] });

    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({
        embeds: [
          prettyEmbed({
            description: chunks[i].join("\n"),
            color: COLORS.info,
            footer: `Page ${i + 1}/${chunks.length}`,
          }),
        ],
        flags: 1 << 6,
      }).catch(() => {});
    }
  },
};

export default command;
