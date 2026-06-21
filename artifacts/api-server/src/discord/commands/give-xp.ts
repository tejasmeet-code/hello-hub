import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  getLevelConfig,
  getMemberLevel,
  addMemberXp,
  setMemberLevelDirectly,
} from "../storage/levels";
import { totalXpForLevel } from "../utils/levelCalc";
import { CE } from "../utils/embedStyle";
import { isAdminOrOwner } from "../utils/staffPerms";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("give-xp")
    .setDescription("Admin: give or remove XP / set levels for any member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) =>
      o.setName("user").setDescription("Member to modify").setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName("amount")
        .setDescription("Amount of XP or levels to give (negative to remove)")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("type")
        .setDescription("Whether to give XP or set levels directly")
        .setRequired(true)
        .addChoices(
          { name: "XP (add/remove)", value: "xp" },
          { name: "Levels (set exact level)", value: "levels" },
        ),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId) {
      await interaction.reply({ content: "Server only.", ephemeral: true });
      return;
    }

    const ok = await isAdminOrOwner(interaction.member as any, interaction.guild);
    if (!ok) {
      await interaction.reply({ content: `${CE.error.str} You need **Manage Server** or admin permissions.`, ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const lc = await getLevelConfig(interaction.guildId);
    if (!lc.enabled) {
      await interaction.editReply({ content: `${CE.error.str} Leveling is not enabled in this server.` });
      return;
    }

    const target = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const type = interaction.options.getString("type", true) as "xp" | "levels";

    let resultLevel: number;
    let resultTotalXp: number;

    if (type === "xp") {
      const { data } = await addMemberXp(interaction.guildId, target.id, amount);
      resultLevel = data.level;
      resultTotalXp = data.totalXp;
    } else {
      // "levels" — set exact level
      const newLevel = Math.max(0, lc.levelLimit !== null ? Math.min(lc.levelLimit, amount) : amount);
      const data = await setMemberLevelDirectly(interaction.guildId, target.id, newLevel);
      resultLevel = data.level;
      resultTotalXp = data.totalXp;
    }

    // Assign level roles if configured
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member && lc.levelRoles.length > 0) {
      const eligible = lc.levelRoles.filter((lr) => lr.level <= resultLevel).map((lr) => lr.roleId);
      if (!lc.stackRoles) {
        const toRemove = lc.levelRoles.filter((lr) => lr.level < resultLevel).map((lr) => lr.roleId)
          .filter((id) => member.roles.cache.has(id));
        if (toRemove.length) await member.roles.remove(toRemove, "Level role sync").catch(() => {});
      }
      const toAdd = eligible.filter((id) => !member.roles.cache.has(id));
      if (toAdd.length) await member.roles.add(toAdd, `Level role sync (Level ${resultLevel})`).catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setColor(lc.embedColor)
      .setTitle(`${CE.success.str} Level data updated`)
      .addFields(
        { name: "User", value: `${target} (${target.id})`, inline: true },
        { name: "New Level", value: String(resultLevel), inline: true },
        { name: "Total XP", value: resultTotalXp.toLocaleString(), inline: true },
        { name: "Change", value: type === "xp" ? `${amount > 0 ? "+" : ""}${amount} XP` : `Set to Level ${resultLevel}`, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
