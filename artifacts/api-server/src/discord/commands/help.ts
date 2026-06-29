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

const CATEGORIES: { id: string; label: string; emoji: string; desc: string; commands: string[] }[] = [
  { id: "overview", label: "Overview & Help", emoji: CE.information.str, desc: "Main menu", commands: [] },
  { id: "setup", label: "Setup Guide", emoji: CE.settings.str, desc: "How to setup the bot", commands: [] },
  { id: "faq", label: "FAQ", emoji: CE.clipboard.str, desc: "Frequently Asked Questions", commands: [] },
  { id: "mod", label: "Moderation", emoji: CE.moderation.str, desc: "Tools to keep your server safe", commands: ["ban", "kick", "mute", "unmute", "warn", "unwarn", "timeout", "untimeout", "jail", "unjail", "case", "edit-case", "modhistory", "purge", "lock", "unlock", "slowmode", "nuke", "appeal"] },
  { id: "staff", label: "Staff & Admin", emoji: CE.admin.str, desc: "Server configuration and staff tracking", commands: ["config", "bot-admin", "ai-admin", "loa", "staff-report", "promote", "demote", "staff-roles", "bot-check", "maintenance", "whitelist", "whitelist-global", "verify-owner", "setup"] },
  { id: "economy", label: "Economy & Levels", emoji: CE.cash.str, desc: "Ranks, shop, and currency", commands: ["rank", "leaderboard", "give-xp", "slots"] },
  { id: "fun", label: "Fun & Games", emoji: CE.giveaway.str, desc: "Games, minigames, and fun commands", commands: ["8ball", "coinflip", "roll", "rps", "tictactoe", "connect4", "hangman", "trivia", "wouldyourather", "wordscramble", "meme", "ship", "spooky", "guess", "higherlower", "russianroulette"] },
  { id: "utility", label: "Utility & Info", emoji: CE.information.str, desc: "Useful tools and information", commands: ["help", "ping", "serverinfo", "userinfo", "botinfo", "roleinfo", "avatar", "setavatar", "servercount", "poll", "announce", "dm", "note", "pull", "giveaway", "staff-database"] },
];

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("List all available slash commands with premium categories."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const allCommands = getGuildCommands();
    
    // Map commands to categories
    const categoryMap = new Map<string, SlashCommand[]>();
    const uncategorized: SlashCommand[] = [];

    CATEGORIES.forEach(c => categoryMap.set(c.id, []));

    const localCategories = [...CATEGORIES];

    for (const cmd of allCommands) {
      let found = false;
      for (const cat of localCategories) {
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
      localCategories.push({ id: "other", label: "Other", emoji: CE.folder.str, desc: "Uncategorized commands", commands: [] });
    }

    const buildEmbed = (categoryId: string) => {
      const cat = localCategories.find(c => c.id === categoryId);
      
      if (categoryId === "overview") {
        return new EmbedBuilder()
          .setTitle(`Relosta Bot Help Menu`)
          .setColor(COLORS.primary)
          .setDescription(`Relosta Bot is the only moderation and utility bot you'll ever need! Explore its features and configure the best systems for your server!\n\n` +
            `**${CE.folder.str} Commands**\n` +
            `> Browse through Relosta Bot's\n> command categories in the dropdown\n> below to find new utilities!\n\n` +
            `**${CE.information.str} FAQ**\n` +
            `> Solutions for the most frequent\n> questions our users have when\n> implementing the bot on their\n> server.\n\n` +
            `**${CE.settings.str} Setup**\n` +
            `> The steps to follow when\n> setting the bot up for the first time on\n> any server.`)
          .setThumbnail(interaction.client.user?.displayAvatarURL() || null);
      }

      if (categoryId === "setup") {
        return new EmbedBuilder()
          .setTitle(`${CE.settings.str} Relosta Bot Setup Guide`)
          .setColor(COLORS.primary)
          .setDescription(`Follow these steps to fully configure Relosta Bot for your server:\n\n` + 
            `**1. Configuration Menu**\n` + 
            `Run </config:0> to open the main configuration panel. This interactive menu will allow you to set up logging channels, moderation settings, and toggle active modules.\n\n` + 
            `**2. Role Hierarchy**\n` + 
            `Make sure to drag the **Relosta Bot** role above all other normal roles in your Server Settings -> Roles. The bot cannot moderate users who have a role higher than it.\n\n` + 
            `**3. Staff & Permissions**\n` + 
            `Use the </config:0> command to set the "Moderator Role" and "Admin Role" so your staff can use the bot's commands.\n\n` + 
            `**4. Automations**\n` + 
            `Automations (like Anti-Spam or Anti-Raid) can be toggled inside the config menu. Make sure to set your logging channels so you receive alerts when automations trigger!`)
          .setThumbnail(interaction.client.user?.displayAvatarURL() || null);
      }

      if (categoryId === "faq") {
        return new EmbedBuilder()
          .setTitle(`${CE.clipboard.str} Frequently Asked Questions`)
          .setColor(COLORS.primary)
          .setDescription(`**Q: Why is the bot saying "Interaction Failed"?**\n` +
            `A: This usually means the bot restarted recently and the old buttons/menus in chat have expired. Just re-run the command to get a fresh menu.\n\n` +
            `**Q: The bot says it can't ban/kick someone, why?**\n` +
            `A: The bot's highest role must be placed physically higher in the server role list than the user you are trying to punish. Also check that the bot has the correct permissions.\n\n` +
            `**Q: How do I backup my server?**\n` +
            `A: Use the </server-backup:0> command to create and load backups. Make sure you don't share backup IDs publicly!\n\n` +
            `**Q: How do cross-server bans work?**\n` +
            `A: Our system can propagate bans across multiple linked servers to keep out known threats. You can toggle this feature in your config.`)
          .setThumbnail(interaction.client.user?.displayAvatarURL() || null);
      }

      const cmds = categoryMap.get(categoryId) || [];
      
      return new EmbedBuilder()
        .setTitle(`${cat?.emoji} ${cat?.label} Commands`)
        .setColor(COLORS.primary)
        .setDescription(
          cmds.length > 0 
            ? cmds.map(c => `**\`/${c.data.name}\`** — ${c.data.description}`).join("\n")
            : "*No commands found in this category.*"
        )
        .setFooter({ text: `Total commands in category: ${cmds.length}` });
    };

    const buildMenu = (selected: string) => {
      const menu = new StringSelectMenuBuilder()
        .setCustomId("help_category_select")
        .setPlaceholder("Select a command category...");

      for (const cat of localCategories) {
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

    const message = await interaction.editReply({
      embeds: [buildEmbed("overview")],
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
