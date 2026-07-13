import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  addAutomation,
  listAutomations,
  removeAutomation,
  setAutomationEnabled,
  type AutomationAction,
  type AutomationTrigger,
  type ModActionKind,
} from "../storage/automations";
import { COLORS, CE, prettyEmbed } from "../utils/embedStyle";

const TRIGGER_CHOICES = [
  { name: "Role added", value: "role_added" },
  { name: "Role removed", value: "role_removed" },
  { name: "Member joined", value: "member_joined" },
  { name: "Member left", value: "member_left" },
  { name: "Moderation action", value: "mod_action" },
] as const;

const ACTION_CHOICES = [
  { name: "DM the affected user", value: "dm_user" },
  { name: "DM the moderator (mod actions only)", value: "dm_moderator" },
  { name: "Post in a channel", value: "channel_message" },
] as const;

const MOD_ACTION_CHOICES = [
  { name: "Any moderation action", value: "any" },
  { name: "Ban", value: "ban" },
  { name: "Kick", value: "kick" },
  { name: "Mute", value: "mute" },
  { name: "Jail", value: "jail" },
  { name: "Warn", value: "warn" },
] as const;

function describeTrigger(t: AutomationTrigger, guildId: string): string {
  switch (t.type) {
    case "role_added":   return `Role added: <@&${t.roleId}>`;
    case "role_removed": return `Role removed: <@&${t.roleId}>`;
    case "member_joined": return "Member joined the server";
    case "member_left":   return "Member left the server";
    case "mod_action":    return `Moderation action: \`${t.action}\``;
  }
}

function describeAction(a: AutomationAction): string {
  switch (a.type) {
    case "dm_user":        return "DM the affected user";
    case "dm_moderator":   return "DM the moderator";
    case "channel_message": return `Post in <#${a.channelId}>`;
  }
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("automations")
    .setDescription("Configure automated responses to server events.")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Create a new automation.")
        .addStringOption((o) =>
          o.setName("name").setDescription("Friendly name").setRequired(true).setMaxLength(60),
        )
        .addStringOption((o) =>
          o.setName("trigger").setDescription("What event fires this automation")
            .setRequired(true)
            .addChoices(...TRIGGER_CHOICES),
        )
        .addStringOption((o) =>
          o.setName("action").setDescription("What should happen when the trigger fires")
            .setRequired(true)
            .addChoices(...ACTION_CHOICES),
        )
        .addStringOption((o) =>
          o.setName("message")
            .setDescription("Message text (for reply action)")
            .setRequired(false)
            .setMaxLength(1000),
        )
        .addRoleOption((o) =>
          o.setName("role").setDescription("Role (for add_role action)").setRequired(false),
        )
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Target channel (required for channel_message)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false),
        )
        .addStringOption((o) =>
          o.setName("mod_action").setDescription("Which mod action (required for mod_action trigger)")
            .setRequired(false)
            .addChoices(...MOD_ACTION_CHOICES),
        ),
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("List all automations in this server."))
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Delete an automation by id.")
        .addStringOption((o) => o.setName("id").setDescription("Automation id from /automations list").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName("toggle").setDescription("Enable or disable an automation.")
        .addStringOption((o) => o.setName("id").setDescription("Automation id").setRequired(true))
        .addBooleanOption((o) => o.setName("enabled").setDescription("On or off").setRequired(true)),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.guildId) return;
    const { isManager } = await import("../utils/staffPerms");
    if (!await isManager(interaction)) {
      await interaction.reply({ content: "Only server managers or Bot Admins can use this command.", flags: 1 << 6 });
      return;
    }
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === "list") {
      const list = await listAutomations(guildId);
      if (list.length === 0) {
        await interaction.reply({ content: `${CE.information.str} No automations yet. Use \`/automations add\` to create one.`, ephemeral: true });
        return;
      }
      const lines = list.map((a) => {
        const status = a.enabled ? `${CE.success.str}` : CE.failure.str;
        return `${status} \`${a.id}\` • **${a.name}**\n  ↳ When: ${describeTrigger(a.trigger, guildId)}\n  ↳ Then: ${describeAction(a.action)}`;
      });
      await interaction.reply({
        embeds: [prettyEmbed({
          title: "Automations",
          description: lines.join("\n\n"),
          color: COLORS.neutral,
          footer: `${list.length} automation${list.length === 1 ? "" : "s"}`,
        })],
        ephemeral: true,
      });
      return;
    }

    if (sub === "remove") {
      const id = interaction.options.getString("id", true);
      const ok = await removeAutomation(guildId, id);
      await interaction.reply({
        content: ok ? `${CE.success.str} Removed automation \`${id}\`.` : `${CE.error.str} No automation with id \`${id}\`.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "toggle") {
      const id = interaction.options.getString("id", true);
      const enabled = interaction.options.getBoolean("enabled", true);
      const ok = await setAutomationEnabled(guildId, id, enabled);
      await interaction.reply({
        content: ok ? `${CE.success.str} Automation \`${id}\` is now **${enabled ? "enabled" : "disabled"}**.`
                    : `${CE.error.str} No automation with id \`${id}\`.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "add") {
      const name = interaction.options.getString("name", true);
      const triggerType = interaction.options.getString("trigger", true);
      const actionType = interaction.options.getString("action", true);
      const message = interaction.options.getString("message", true);
      const role = interaction.options.getRole("role");
      const channel = interaction.options.getChannel("channel");
      const modAction = interaction.options.getString("mod_action") as ModActionKind | null;

      let trigger: AutomationTrigger;
      if (triggerType === "role_added" || triggerType === "role_removed") {
        if (!role) {
          await interaction.reply({ content: `${CE.error.str} Pick a **role** for that trigger.`, ephemeral: true });
          return;
        }
        trigger = { type: triggerType, roleId: role.id };
      } else if (triggerType === "member_joined" || triggerType === "member_left") {
        trigger = { type: triggerType };
      } else if (triggerType === "mod_action") {
        trigger = { type: "mod_action", action: (modAction ?? "any") as ModActionKind };
      } else {
        await interaction.reply({ content: `${CE.error.str} Unknown trigger.`, ephemeral: true });
        return;
      }

      let action: AutomationAction;
      if (actionType === "channel_message") {
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({ content: `${CE.error.str} Pick a **text channel** for that action.`, ephemeral: true });
          return;
        }
        action = { type: "channel_message", channelId: channel.id, message };
      } else if (actionType === "dm_user") {
        action = { type: "dm_user", message };
      } else if (actionType === "dm_moderator") {
        if (trigger.type !== "mod_action") {
          await interaction.reply({ content: `${CE.error.str} \`DM the moderator\` only works with the \`mod_action\` trigger.`, ephemeral: true });
          return;
        }
        action = { type: "dm_moderator", message };
      } else {
        await interaction.reply({ content: `${CE.error.str} Unknown action.`, ephemeral: true });
        return;
      }

      const automation = await addAutomation(guildId, { name, trigger, action });
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle(`${CE.success.str} Automation created`)
          .setDescription(
            `**${automation.name}** \`${automation.id}\`\n` +
            `↳ When: ${describeTrigger(automation.trigger, guildId)}\n` +
            `↳ Then: ${describeAction(automation.action)}`,
          )
          .setFooter({ text: "Use /automations list to manage" })],
        ephemeral: true,
      });
      return;
    }
  },
};

export default command;
