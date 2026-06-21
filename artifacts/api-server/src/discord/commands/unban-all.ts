import {
  ChannelType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { CE } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("unban-all")
    .setDescription("Unban all currently banned users from this server.")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "ban"))) return;
    if (!interaction.guild || !interaction.guildId) return;

    await interaction.reply({ content: "⛔ Unban-all initiated. Stand by.", flags: 1 << 6 });

    const guild = interaction.guild;
    const bans = await guild.bans.fetch().catch(() => null);
    if (!bans) {
      await interaction.editReply("Failed to fetch banned users.");
      return;
    }

    if (bans.size === 0) {
      await interaction.editReply("There are no banned users to unban.");
      return;
    }

    const invite = await createServerInvite(interaction);
    let unbanned = 0;
    for (const ban of bans.values()) {
      const userId = ban.user.id;
      const result = await guild.bans.remove(userId, "unban-all").catch(() => null);
      if (!result) continue;
      unbanned++;
      if (invite) {
        ban.user.send(
          `You were unbanned from **${guild.name}**. Rejoin here: ${invite}`,
        ).catch(() => {});
      }
    }

    await interaction.editReply(
      `${CE.success.str} Unbanned **${unbanned}** user${unbanned === 1 ? "" : "s"}.${
        invite ? ` Invite: ${invite}` : ""
      }`,
    );
  },
};

async function createServerInvite(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const guild = interaction.guild;
  if (!guild) return null;
  const channel = interaction.channel;
  if (channel && "createInvite" in channel && typeof channel.createInvite === "function") {
    try {
      const invite = await channel.createInvite({ maxAge: 86400, unique: true, reason: "unban-all invite" });
      return invite.url;
    } catch {
      // ignore and fall back
    }
  }

  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) return null;

  const me = guild.members.me;
  for (const ch of channels.values()) {
    if (!ch || ch.type !== ChannelType.GuildText) continue;
    if (!me) continue;
    if (!ch.permissionsFor(me)?.has("CreateInstantInvite")) continue;
    try {
      const invite = await ch.createInvite({ maxAge: 86400, unique: true, reason: "unban-all invite" });
      return invite.url;
    } catch {
      continue;
    }
  }

  return null;
}

export default command;