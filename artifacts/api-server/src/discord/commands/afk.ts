import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "../types";
import { supabase } from "../storage/supabase";
import { successEmbed } from "../utils/embedStyle";

export default {
  data: new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Set your status as AFK (Away From Keyboard).")
    .addStringOption((o) =>
      o
        .setName("reason")
        .setDescription("Reason for being AFK")
        .setRequired(false)
        .setMaxLength(100),
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: "This command can only be used in a server." });
      return;
    }
    
    // Defer the reply to avoid timeout while talking to Supabase / Discord API
    await interaction.deferReply();

    const reason = interaction.options.getString("reason") || "AFK";
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    // Fetch existing AFK store
    let afkData: Record<string, { reason: string; timestamp: number }> = {};
    
    if (supabase) {
      const { data: dbData } = await supabase
        .from("bot_json_store")
        .select("payload")
        .eq("store_name", `afk_${guildId}`)
        .single();

      if (dbData?.payload) {
        afkData = dbData.payload as typeof afkData;
      }

      afkData[userId] = {
        reason,
        timestamp: Date.now(),
      };

      // Upsert AFK data
      await supabase.from("bot_json_store").upsert({
        store_name: `afk_${guildId}`,
        payload: afkData,
      });
    }

    // Try to rename user to [AFK] Name
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (member) {
      const currentNickname = member.displayName;
      if (!currentNickname.startsWith("[AFK]")) {
        // Only allow a nickname length of up to 32 characters
        let newNickname = `[AFK] ${currentNickname}`;
        if (newNickname.length > 32) newNickname = newNickname.substring(0, 32);
        
        await member.setNickname(newNickname, "User went AFK").catch(() => {});
      }
    }

    await interaction.editReply({
      embeds: [successEmbed("You are now AFK", `**Reason:** ${reason}`)],
    });
  },
} as SlashCommand;

export async function handleAFK(message: import("discord.js").Message) {
  if (message.author.bot || !message.inGuild()) return;
  const guildId = message.guildId;
  const userId = message.author.id;

  if (!supabase) return;

  const { data: dbData } = await supabase
    .from("bot_json_store")
    .select("payload")
    .eq("store_name", `afk_${guildId}`)
    .single();

  if (dbData?.payload) {
    const afkData = dbData.payload as Record<string, { reason: string; timestamp: number }>;
    
    // Check if author was AFK, remove it
    if (afkData[userId]) {
      delete afkData[userId];
      await supabase.from("bot_json_store").upsert({
        store_name: `afk_${guildId}`,
        payload: afkData,
      });

      const member = message.member ?? await message.guild.members.fetch(userId).catch(() => null);
      if (member) {
        if (member.displayName.startsWith("[AFK] ")) {
          const originalName = member.displayName.substring(6);
          await member.setNickname(originalName, "User returned from AFK").catch(() => {});
        }
      }
      
      const { EmbedBuilder } = await import("discord.js");
      const { COLORS } = await import("../utils/embedStyle");
      await message.channel.send({ content: `<@${userId}>`, embeds: [new EmbedBuilder().setColor(COLORS.success).setDescription(`Welcome back! I've removed your AFK status.`)] }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
    }

    // Check if anyone mentioned is AFK
    const mentionedUsers = message.mentions.users.filter(u => !u.bot && u.id !== userId);
    if (mentionedUsers.size > 0) {
      for (const [id, user] of mentionedUsers) {
        if (afkData[id]) {
          const afk = afkData[id];
          const { EmbedBuilder } = await import("discord.js");
          const { COLORS } = await import("../utils/embedStyle");
          const timestamp = Math.floor(afk.timestamp / 1000);
          await message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.primary)
                .setDescription(`**${user.username}** is AFK: ${afk.reason} (<t:${timestamp}:R>)`)
            ]
          }).catch(() => {});
        }
      }
    }
  }
}
