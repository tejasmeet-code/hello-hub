import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder
} from "discord.js";
import type { SlashCommand } from "../types";
import { getGuildCommands } from "../registry";
import { COLORS, CE, EMOJI } from "../utils/embedStyle";

const CATEGORIES = [
  { id: "mod", label: "Moderation", emoji: CE.moderation.str, desc: "Tools to keep your server safe", commands: ["ban", "kick", "mute", "unmute", "warn", "unwarn", "timeout", "untimeout", "jail", "unjail", "case", "edit-case", "modhistory", "purge", "lock", "unlock", "slowmode", "nuke", "appeal"] },
  { id: "staff", label: "Staff & Admin", emoji: CE.admin.str, desc: "Server configuration and staff tracking", commands: ["config", "bot-admin", "ai-admin", "loa", "staff-report", "promote", "demote", "staff-roles", "bot-check", "maintenance", "whitelist", "whitelist-global", "verify-owner", "setup"] },
  { id: "economy", label: "Economy & Levels", emoji: CE.cash.str, desc: "Ranks, shop, and currency", commands: ["rank", "leaderboard", "give-xp", "slots"] },
  { id: "fun", label: "Fun & Games", emoji: CE.giveaway.str, desc: "Games, minigames, and fun commands", commands: ["8ball", "coinflip", "roll", "rps", "tictactoe", "connect4", "hangman", "trivia", "wouldyourather", "wordscramble", "meme", "ship", "spooky", "guess", "higherlower", "russianroulette"] },
  { id: "utility", label: "Utility & Info", emoji: CE.information.str, desc: "Useful tools and information", commands: ["help", "ping", "serverinfo", "userinfo", "botinfo", "roleinfo", "avatar", "setavatar", "servercount", "poll", "announce", "dm", "note", "pull", "giveaway"] },
];

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("List all available slash commands with premium categories."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 1 << 6 });

    const allCommands = getGuildCommands();
    
    // Map commands to categories
    const categoryMap = new Map<string, SlashCommand[]>();
    const uncategorized: SlashCommand[] = [];

    CATEGORIES.forEach(c => categoryMap.set(c.id, []));

    for (const cmd of allCommands) {
      let found = false;
      for (const cat of CATEGORIES) {
        if (cat.commands.includes(cmd.data.name)) {
          categoryMap.get(cat.id)?.push(cmd);
          found = true;
          break;
        }
      }
      if (!found) uncategorized.push(cmd);
    }
    if (uncategorized.length > 0) {
      categoryMap.set("other", uncategorized);
      CATEGORIES.push({ id: "other", label: "Other", emoji: CE.folder.str, desc: "Uncategorized commands", commands: [] });
    }

    const buildEmbed = (categoryId: string) => {
      const cat = CATEGORIES.find(c => c.id === categoryId);
      const cmds = categoryMap.get(categoryId) || [];
      
      return new EmbedBuilder()
        .setTitle(`${cat?.emoji} ${cat?.label} Commands`)
        .setColor(COLORS.primary)
        .setDescription(
          cmds.length > 0 
            ? cmds.map(c => `**\`/${c.data.name}\`** ${EMOJI.dot} ${c.data.description}`).join("\n")
            : "*No commands found in this category.*"
        )
        .setFooter({ text: `Total commands in category: ${cmds.length}` });
    };

    const buildMenu = (selected: string) => {
      const menu = new StringSelectMenuBuilder()
        .setCustomId("help_category_select")
        .setPlaceholder("Select a command category...");

      for (const cat of CATEGORIES) {
        // Skip "other" if it's empty
        if (cat.id === "other" && (!categoryMap.has("other") || categoryMap.get("other")!.length === 0)) continue;
        
        menu.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(cat.label)
            .setDescription(cat.desc)
            .setEmoji(cat.emoji)
            .setValue(cat.id)
            .setDefault(cat.id === selected)
        );
      }

      return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
    };

    // Initial state: show first category (or home/overview)
    // Let's create an overview embed first.
    const overviewEmbed = new EmbedBuilder()
      .setTitle(`${CE.success.str} Relosta Bot Commands`)
      .setColor(COLORS.primary)
      .setDescription(`Welcome to the help menu! Use the dropdown below to explore commands by category.\n\n${CATEGORIES.map(c => `> ${c.emoji} **${c.label}** — ${categoryMap.get(c.id)?.length || 0} cmds`).join("\n")}`)
      .setThumbnail(interaction.client.user?.displayAvatarURL() || null);

    const message = await interaction.editReply({
      embeds: [overviewEmbed],
      components: [buildMenu("overview")],
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 300_000, // 5 minutes
    });

    collector.on("collect", async (i) => {
      if (i.customId === "help_category_select") {
        const catId = i.values[0];
        await i.update({
          embeds: [buildEmbed(catId)],
          components: [buildMenu(catId)],
        });
      }
    });

    collector.on("end", async () => {
      // Disable the select menu when the collector ends
      const disabledMenu = buildMenu("").components[0].setDisabled(true);
      const disabledRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(disabledMenu);
      await interaction.editReply({ components: [disabledRow] }).catch(() => {});
    });
  },
};

export default command;
