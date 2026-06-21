import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
  type Role,
  type TextChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  getGuildConfig,
  updateGuildConfig,
  getInfractionsConfig,
  getQuotaFailureConfig,
  getModerationConfig,
  getPromotionsConfig,
  getDemotionsConfig,
  getAppealsConfig,
  getLoaConfig,
  getStaffReportConfig,
  getPartnershipConfig,
  getAntiNukeConfig,
  type GuildConfig,
  type PartnershipConfig,
  type QuotaFailureConfig,
  type FailureAction,
  type RoleQuota,
  type AntiNukePunishment,
  type AntiNukeMiniId,
} from "../storage/config";
import { CE } from "../utils/embedStyle";
import { isAdminOrOwner } from "../utils/staffPerms";
import { PERM_WHITELIST } from "../storage/whitelist";
import { logger } from "../../lib/logger";
import { addStaffRole, listStaffRoles, removeStaffRole } from "../storage/staff";
import { getTicketsConfig, updateTicketsConfig, type TicketsModuleConfig, type TicketPanel, type TicketQuestion } from "../storage/tickets";
import { getAutomodConfig, updateAutomodConfig } from "../storage/automod";
import { getWelcomerConfig, updateWelcomerConfig, type WelcomerConfig, type WelcomerEmbedConfig } from "../storage/welcomer";
import { BACKGROUND_PRESETS } from "../utils/welcomeImage";
import { getLevelConfig, updateLevelConfig, type LevelConfig, type LevelRole } from "../storage/levels";
import {
  getShopSettings, updateShopSettings, generateShopId,
  type GuildShopSettings, type ShopMiniConfig, type ShopStatus,
} from "../storage/shop";

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

interface ModuleDef {
  id: string;
  label: string;
  emoji: { str: string; id: string; name: string };
  moduleKey: keyof GuildConfig["modules"];
  channelKey: keyof GuildConfig["channels"] | null;
  description: string;
}

const MODULE_DEFS: ModuleDef[] = [
  {
    id: "moderation",
    label: "Suspensions",
    emoji: CE.moderation,
    moduleKey: "moderation",
    channelKey: "moderation",
    description: "Ban, mute, kick, jail, and warn actions.",
  },
  {
    id: "infractions",
    label: "Infractions",
    emoji: CE.warning,
    moduleKey: "infractions",
    channelKey: "infractions",
    description: "Strike and infraction log channel.",
  },
  {
    id: "promotions",
    label: "Promotions",
    emoji: CE.promotion,
    moduleKey: "staffMgmt",
    channelKey: "promotions",
    description: "Staff promotion announcement channel.",
  },
  {
    id: "demotions",
    label: "Demotions",
    emoji: CE.demotion,
    moduleKey: "staffMgmt",
    channelKey: "demotions",
    description: "Staff demotion announcement channel.",
  },
  {
    id: "botNotifications",
    label: "Bot Notifications",
    emoji: CE.notifications,
    moduleKey: "moderation",
    channelKey: "botNotifications",
    description: "Channel for bot alerts and notifications.",
  },
  {
    id: "performance",
    label: "Staff Performance",
    emoji: CE.staff,
    moduleKey: "staffMgmt",
    channelKey: "performance",
    description: "Staff performance reviews and evaluations.",
  },
  {
    id: "appeals",
    label: "Appeals",
    emoji: CE.information,
    moduleKey: "appeals",
    channelKey: "appeals",
    description: "Punishment appeal review channel.",
  },
  {
    id: "partnership",
    label: "Partnerships",
    emoji: CE.link,
    moduleKey: "partnership",
    channelKey: "partnershipCheck",
    description: "Send partnership requests for approval and announce approved partners.",
  },
  {
    id: "verify",
    label: "Verification",
    emoji: CE.check,
    moduleKey: "verify",
    channelKey: "verifyChannel",
    description: "Channel for server verification prompts and role assignment.",
  },
  {
    id: "loa",
    label: "Leave of Absence",
    emoji: CE.members,
    moduleKey: "loa",
    channelKey: "loaLog",
    description: "Staff LOA requests and tracking.",
  },
  {
    id: "staff",
    label: "Staff",
    emoji: CE.admin,
    moduleKey: "staffMgmt",
    channelKey: "staffLog",
    description: "Manage staff roles and hierarchy.",
  },
  {
    id: "staffReport",
    label: "Staff Report",
    emoji: CE.settings,
    moduleKey: "staffMgmt",
    channelKey: "staffReport",
    description: "Auto-updating staff tier report channel.",
  },
  {
    id: "quota",
    label: "Message Quota",
    emoji: CE.moderation,
    moduleKey: "quota",
    channelKey: "quotaLog",
    description: "Weekly message and mod-action quota targets.",
  },
  {
    id: "banRequest",
    label: "Ban Request",
    emoji: CE.moderation,
    moduleKey: "banRequest",
    channelKey: "banRequest",
    description: "Channel where lower staff submit ban requests for senior review.",
  },
  {
    id: "antiNuke",
    label: "Anti-Nuke",
    emoji: CE.admin,
    moduleKey: "antiNuke",
    channelKey: null,
    description: "Protect the server from mass destructive actions and manage who can bypass anti-nuke checks.",
  },
  {
    id: "roleMemory",
    label: "Role Memory",
    emoji: CE.members,
    moduleKey: "roleMemory",
    channelKey: "roleMemoryLog",
    description: "Remember member roles and restore them when they rejoin.",
  },
  {
    id: "serverMaintenance",
    label: "Server Maintenance",
    emoji: CE.settings,
    moduleKey: "serverMaintenance",
    channelKey: null,
    description: "Maintenance mode — creates a restricted category and lets you swap member roles with a button.",
  },
];

/** Modules that have custom per-module settings beyond channel/roles. */
const MODULES_WITH_SETTINGS = new Set([
  "moderation",
  "infractions",
  "promotions",
  "demotions",
  "appeals",
  "partnership",
  "verify",
  "loa",
  "staffReport",
  "antiNuke",
]);

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Shop config UI ────────────────────────────────────────────────────────────

function buildShopOverviewEmbed(ss: GuildShopSettings): EmbedBuilder {
  const shopList = Object.values(ss.shops);
  const shopLines = shopList.length > 0
    ? shopList.map((s) =>
        `• **${s.name}** — Ch: ${s.channelId ? `<#${s.channelId}>` : "*not set*"} · ${s.questions.length} question(s)`,
      ).join("\n")
    : "*No shops added yet — click **Add Shop** to create one.*";

  return new EmbedBuilder()
    .setTitle(`${CE.shoppingcart.str} Shop Module`)
    .setColor(ss.enabled ? 0x57f287 : 0xed4245)
    .addFields(
      { name: "Status", value: ss.enabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`, inline: true },
      { name: "Shops", value: `**${shopList.length}**`, inline: true },
      { name: "Mod Roles", value: ss.modRoleIds.length > 0 ? ss.modRoleIds.map((r) => `<@&${r}>`).join(", ") : "*None set*", inline: false },
      { name: "Admin Roles", value: ss.adminRoleIds.length > 0 ? ss.adminRoleIds.map((r) => `<@&${r}>`).join(", ") : "*None set*", inline: false },
      { name: "Log Channel", value: ss.logChannelId ? `<#${ss.logChannelId}>` : "*Not set*", inline: true },
      { name: "Transcript Channel", value: ss.transcriptChannelId ? `<#${ss.transcriptChannelId}>` : "*Not set*", inline: true },
      { name: "Customer Role", value: ss.customerRoleId ? `<@&${ss.customerRoleId}> *(given on first purchase)*` : "*Not set*", inline: false },
      { name: `${CE.information.str} Shops`, value: shopLines, inline: false },
    )
    .setFooter({ text: "Tickets: {shopname}-{username}-{no} | Set category per-shop for auto-sorting" });
}

function shopOverviewRows(ss: GuildShopSettings): Row[] {
  const rows: Row[] = [];

  const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:shop:toggle")
      .setLabel(ss.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable")
      .setStyle(ss.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("cfg:shop:addShop")
      .setLabel("Add Shop")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(CE.shoppingcart.str),
  );
  rows.push(row1);

  const row2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:shop:setModRoles")
      .setLabel("Set Mod Roles")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.staff.str),
    new ButtonBuilder()
      .setCustomId("cfg:shop:setAdminRoles")
      .setLabel("Set Admin Roles")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.admin.str),
    new ButtonBuilder()
      .setCustomId("cfg:shop:setLogChannel")
      .setLabel(ss.logChannelId ? "Change Log Channel" : "Set Log Channel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.notifications.str),
    new ButtonBuilder()
      .setCustomId("cfg:shop:setTranscriptChannel")
      .setLabel(ss.transcriptChannelId ? "Change Transcript Channel" : "Set Transcript Channel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.information.str),
  );
  rows.push(row2);

  const row3 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:shop:setProofChannel")
      .setLabel(ss.proofChannelId ? "Change Proof Channel" : "Set Proof Channel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.information.str),
    new ButtonBuilder()
      .setCustomId("cfg:shop:setCustomerRole")
      .setLabel(ss.customerRoleId ? "Change Customer Role" : "Set Customer Role")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.ltc.str),
    new ButtonBuilder()
      .setCustomId("cfg:shop:customerRoleClear")
      .setLabel("Clear Customer Role")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!ss.customerRoleId),
  );
  rows.push(row3);

  const shopList = Object.values(ss.shops);
  if (shopList.length > 0) {
    const sel = new StringSelectMenuBuilder()
      .setCustomId("cfg:shop:shopSelect")
      .setPlaceholder("Select a shop to configure")
      .addOptions(
        shopList.slice(0, 25).map((s) => ({
          label: s.name.slice(0, 25),
          value: s.id,
          description: `Channel: ${s.channelId ? "set" : "not set"} · ${s.questions.length} question(s)`,
        })),
      );
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sel));
  }

  rows.push(backRow());
  return rows;
}

function buildShopMiniEmbed(shop: ShopMiniConfig, _ss: GuildShopSettings): EmbedBuilder {
  const questionLines = shop.questions.length > 0
    ? shop.questions.map((q, i) => `**${i + 1}.** ${q}`).join("\n")
    : "*No questions set — default question will be used*";

  const embedSummary = [
    shop.embed.title ? `**Title:** ${shop.embed.title}` : null,
    shop.embed.description ? `**Description:** ${shop.embed.description.slice(0, 60)}...` : null,
    shop.embed.thumbnail ? `**Thumbnail:** set` : null,
    shop.embed.image ? `**Image:** set` : null,
    shop.embed.footer ? `**Footer:** ${shop.embed.footer}` : null,
    shop.embed.fields && shop.embed.fields.length > 0 ? `**Fields:** ${shop.embed.fields.length}` : null,
  ].filter(Boolean).join("\n") || "*No embed settings — a default embed will be used*";

  const statusDisplay = shop.status === "coming_soon"
    ? `${CE.limited.str} Coming Soon`
    : shop.status === "out_of_stock"
    ? `${CE.discount.str} Out of Stock`
    : `${CE.success.str} Active`;
  const statusColor = shop.status === "out_of_stock" ? 0xed4245 : shop.status === "coming_soon" ? 0xfee75c : 0x57f287;

  return new EmbedBuilder()
    .setTitle(`${CE.shoppingcart.str} Shop — ${shop.name}`)
    .setColor(statusColor)
    .addFields(
      { name: "Status", value: statusDisplay, inline: true },
      { name: "Channel", value: shop.channelId ? `<#${shop.channelId}>` : "*Not set*", inline: true },
      { name: "Ticket Category", value: shop.categoryId ? `<#${shop.categoryId}>` : "*None — created at root*", inline: true },
      { name: "Embed Posted", value: shop.messageId ? `${CE.success.str} Yes` : `${CE.error.str} Not posted`, inline: true },
      { name: `${CE.information.str} Questions (up to 5)`, value: questionLines, inline: false },
      { name: `${CE.settings.str} Embed Settings`, value: embedSummary, inline: false },
    )
    .setFooter({ text: `Shop ID: ${shop.id}` });
}

function shopMiniRows(shop: ShopMiniConfig): Row[] {
  const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:shop:mini:setChannel:${shop.id}`)
      .setLabel("Set Channel")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(CE.settings.str),
    new ButtonBuilder()
      .setCustomId(`cfg:shop:mini:setCategory:${shop.id}`)
      .setLabel("Set Category")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.admin.str),
    new ButtonBuilder()
      .setCustomId(`cfg:shop:mini:editQuestions:${shop.id}`)
      .setLabel("Edit Questions")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.information.str),
    new ButtonBuilder()
      .setCustomId(`cfg:shop:mini:editEmbed:${shop.id}`)
      .setLabel("Edit Embed")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.notifications.str),
  );

  const row2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:shop:mini:postEmbed:${shop.id}`)
      .setLabel(shop.messageId ? "Re-Post Embed" : "Post Shop Embed")
      .setStyle(ButtonStyle.Success)
      .setEmoji(CE.discount.str),
    new ButtonBuilder()
      .setCustomId(`cfg:shop:mini:delete:${shop.id}`)
      .setLabel("Delete Shop")
      .setStyle(ButtonStyle.Danger)
      .setEmoji(CE.termination.str),
  );

  const statusSel = new StringSelectMenuBuilder()
    .setCustomId(`cfg:shop:mini:statusSet:${shop.id}`)
    .setPlaceholder(`Status: ${shop.status === "coming_soon" ? "Coming Soon" : shop.status === "out_of_stock" ? "Out of Stock" : "Active"}`)
    .addOptions(
      { label: "Active", value: "active", description: "Buy button shown — tickets can be opened", emoji: { id: CE.success.id, name: CE.success.name } },
      { label: "Coming Soon", value: "coming_soon", description: "No buy button — Coming Soon badge shown", emoji: { id: CE.limited.id, name: CE.limited.name } },
      { label: "Out of Stock", value: "out_of_stock", description: "No buy button — Out of Stock badge shown", emoji: { id: CE.discount.id, name: CE.discount.name } },
    );

  const backToShop = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:shop:overview")
      .setLabel("← Back to Shop Overview")
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(statusSel), backToShop];
}

// ── Utility rows ─────────────────────────────────────────────────────────────

function mainDropdownRow(): Row {
  const sel = new StringSelectMenuBuilder()
    .setCustomId("cfg:module:select")
    .setPlaceholder("Select a Module to Configure")
    .addOptions([
      ...MODULE_DEFS.map((m) => {
        const option: any = {
          label: m.label,
          value: m.id,
          description: m.description,
        };
        if (m.emoji?.id && m.emoji?.name) {
          option.emoji = { id: m.emoji.id, name: m.emoji.name };
        }
        return option;
      }),
      {
        label: "Shop",
        value: "shop",
        emoji: { id: CE.shoppingcart.id, name: CE.shoppingcart.name },
        description: "Sell services via ticketed shops with ratings and stats.",
      },
      {
        label: "Custom Prefix",
        value: "prefix",
        emoji: { id: CE.settings.id, name: CE.settings.name },
        description: "Set a custom command prefix for this server.",
      },
      {
        label: "Bot Profile",
        value: "botProfile",
        emoji: { id: CE.admin.id, name: CE.admin.name },
        description: "Change the bot's nickname and avatar in this server.",
      },
      { label: "Tickets", value: "tickets", emoji: { id: CE.ticket.id, name: CE.ticket.name }, description: "Set up support ticket panels for your server." },
      { label: "Welcomer", value: "welcomer", emoji: { id: CE.members.id, name: CE.members.name }, description: "Greet new members with embeds, image banners, and DMs." },
      { label: "Automod", value: "automod", emoji: { id: CE.automod.id, name: CE.automod.name }, description: "Automated moderation: spam, bad words, links, caps and more." },
      { label: "Levels", value: "levels", emoji: { id: CE.trophy.id, name: CE.trophy.name }, description: "XP-based leveling: chat and VC rewards, roles, leaderboard." },
    ]);
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sel);
}

function closeRow(): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:close")
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger),
  );
}

function backRow(): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:back")
      .setLabel("← Back")
      .setStyle(ButtonStyle.Secondary),
  );
}

// ── Overview embed ───────────────────────────────────────────────────────────

function buildOverviewEmbed(cfg: GuildConfig): EmbedBuilder {
  const moduleLines = MODULE_DEFS.map((m) => {
    const on = cfg.modules[m.moduleKey as keyof typeof cfg.modules] ?? false;
    return `${on ? CE.success.str : CE.error.str} **${m.label}**`;
  });
  const prefix = cfg.guildPrefix ?? "b?";
  return new EmbedBuilder()
    .setTitle("Config Menu")
    .setColor(0x5865f2)
    .setDescription(
      `${CE.settings.str} **Prefix:** \`${prefix}\` (DM: \`${prefix}n\`)\n\n` +
      "Select a module to configure using the dropdown below.\n\n" + moduleLines.join("\n"),
    )
    .setFooter({ text: "Administrators always have access." });
}

// ── Settings summary (one-liner shown in the module embed) ───────────────────

function getModuleSettingsSummary(cfg: GuildConfig, modId: string): string | null {
  switch (modId) {
    case "infractions": {
      const s = getInfractionsConfig(cfg);
      return (
        `Expiry: **${s.strikeExpiryDays === 0 ? "Never" : `${s.strikeExpiryDays}d`}** • ` +
        `DM: ${s.dmOnInfraction ? CE.success.str : CE.error.str} • ` +
        `Auto-Demotion: ${s.autoDemotionEnabled ? CE.success.str : CE.error.str}`
      );
    }
    case "moderation": {
      const s = getModerationConfig(cfg);
      return `DM on action: ${s.dmOnAction ? CE.success.str : CE.error.str}`;
    }
    case "promotions": {
      const s = getPromotionsConfig(cfg);
      return `DM member: ${s.dmMember ? CE.success.str : CE.error.str}`;
    }
    case "demotions": {
      const s = getDemotionsConfig(cfg);
      return `DM member: ${s.dmMember ? CE.success.str : CE.error.str}`;
    }
    case "appeals": {
      const s = getAppealsConfig(cfg);
      return `Auto-close: ${s.autoCloseDays === 0 ? "*Disabled*" : `**${s.autoCloseDays}d**`}`;
    }
    case "loa": {
      const s = getLoaConfig(cfg);
      return (
        `Max: **${s.maxDurationDays === 0 ? "Unlimited" : `${s.maxDurationDays}d`}** • ` +
        `Require reason: ${s.requireReason ? CE.success.str : CE.error.str}`
      );
    }
    case "partnership": {
      const s = getPartnershipConfig(cfg);
      return (
        `Quota: **${s.quota}** approved partnerships
         • Failures: ${s.failureActions[1] ?? "none"}/${s.failureActions[2] ?? "none"}/${s.failureActions[3] ?? "none"}`
      );
    }
    case "quota": {
      const s = getQuotaFailureConfig(cfg);
      return `Failures: **${s.failure1}** / **${s.failure2}** / **${s.failure3plus}**`;
    }
    case "staffReport": {
      const s = getStaffReportConfig(cfg);
      return `Refresh every **${s.refreshIntervalHours}h**`;
    }
    case "antiNuke": {
      const s = getAntiNukeConfig(cfg);
      return (
        `Joins: ${s.antiJoin.enabled ? CE.success.str : CE.error.str} • ` +
        `Bans: ${s.antiBan.enabled ? CE.success.str : CE.error.str} • ` +
        `Kicks: ${s.antiKick.enabled ? CE.success.str : CE.error.str} • ` +
        `Roles: ${s.antiRole.enabled ? CE.success.str : CE.error.str} • ` +
        `Channels: ${s.antiChannel.enabled ? CE.success.str : CE.error.str} • ` +
        `Punishment: **${s.commonPunishment}**`
      );
    }
    default:
      return null;
  }
}

// ── Module embed ─────────────────────────────────────────────────────────────

function buildModuleEmbed(cfg: GuildConfig, mod: ModuleDef): EmbedBuilder {
  const enabled = cfg.modules[mod.moduleKey];
  const channel = mod.channelKey ? cfg.channels[mod.channelKey] : null;
  const roles = cfg.moduleRoles?.[mod.id] ?? [];

  const e = new EmbedBuilder()
    .setTitle(`${mod.emoji.str} ${mod.label}`)
    .setColor(enabled ? 0x57f287 : 0xed4245)
    .addFields(
      { name: "Status", value: enabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`, inline: true },
    );

  if (mod.channelKey !== null) {
    e.addFields({
      name: "Channel",
      value: channel ? `<#${channel}>` : "*Not set*",
      inline: true,
    });
  }

  if (mod.id === "appeals") {
    e.addFields({
      name: "Appeal Server Invite",
      value: cfg.appealServerInvite
        ? `[${cfg.appealServerInvite}](${cfg.appealServerInvite})\n-# Included in ban DMs so banned users can join and use /appeal`
        : "*Not set* — banned users cannot DM the bot without a shared server",
      inline: false,
    });
  }

  if (mod.id === "partnership") {
    e.addFields(
      {
        name: "Approval Channel",
        value: cfg.channels.partnershipCheck ? `<#${cfg.channels.partnershipCheck}>` : "*Not set*",
        inline: true,
      },
      {
        name: "Announcement Channel",
        value: cfg.channels.partnership ? `<#${cfg.channels.partnership}>` : "*Not set*",
        inline: true,
      },
    );
  }

  e.addFields({
    name: "Permitted Roles",
    value: roles.length > 0 ? roles.map((r) => `<@&${r}>`).join(", ") : "*All staff (none set)*",
    inline: false,
  });

  const summary = getModuleSettingsSummary(cfg, mod.id);
  if (summary) {
    e.addFields({ name: `${CE.settings.str} Settings`, value: summary, inline: false });
  }

  return e;
}

// ── Module action rows ────────────────────────────────────────────────────────

function moduleActionRows(cfg: GuildConfig, mod: ModuleDef): Row[] {
  const enabled = cfg.modules[mod.moduleKey];
  const rows: Row[] = [];

  const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:mod:toggle:${mod.id}`)
      .setLabel(enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable")
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Danger),
  );

  if (mod.channelKey !== null) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:mod:setchannel:${mod.id}`)
        .setLabel(mod.id === "partnership" ? "Set Approval Channel" : "Set Channel")
        .setStyle(ButtonStyle.Primary)
        .setEmoji(CE.settings.str),
    );
  }

  // Partnership needs a second channel button for the announcement channel
  if (mod.id === "partnership") {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:partnership:setAnnounce")
        .setLabel("Set Partnership Channel")
        .setStyle(ButtonStyle.Primary)
        .setEmoji(CE.link.str),
    );
  }

  actionRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:mod:setroles:${mod.id}`)
      .setLabel("Set Permissions")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.admin.str),
  );

  if (mod.id === "appeals") {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:appeals:setInvite")
        .setLabel("Set Appeal Server")
        .setStyle(ButtonStyle.Primary)
        .setEmoji(CE.information.str),
    );
  }

  if (MODULES_WITH_SETTINGS.has(mod.id)) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:settings:view:${mod.id}`)
        .setLabel("Settings")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(CE.settings.str),
    );
  }

  rows.push(actionRow);
  rows.push(backRow());
  return rows;
}

// ── Channel / role picker rows ────────────────────────────────────────────────

function channelPickRows(mod: ModuleDef): Row[] {
  const sel = new ChannelSelectMenuBuilder()
    .setCustomId(`cfg:mod:channelset:${mod.id}`)
    .setPlaceholder(`Pick the channel for ${mod.label}`)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);

  const clearRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:mod:channelclear:${mod.id}`)
      .setLabel("Clear Channel")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`cfg:mod:view:${mod.id}`)
      .setLabel("← Back")
      .setStyle(ButtonStyle.Secondary),
  );

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sel),
    clearRow,
  ];
}

function rolePickRows(mod: ModuleDef): Row[] {
  const sel = new RoleSelectMenuBuilder()
    .setCustomId(`cfg:mod:roleset:${mod.id}`)
    .setPlaceholder(`Pick permitted roles for ${mod.label}`)
    .setMinValues(0)
    .setMaxValues(10);

  const clearRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:mod:roleclear:${mod.id}`)
      .setLabel("Clear Roles")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`cfg:mod:view:${mod.id}`)
      .setLabel("← Back")
      .setStyle(ButtonStyle.Secondary),
  );

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sel),
    clearRow,
  ];
}

// ── Per-module settings UI ────────────────────────────────────────────────────

function buildSettingsEmbed(cfg: GuildConfig, modId: string): EmbedBuilder {
  const mod = MODULE_DEFS.find((m) => m.id === modId);
  const e = new EmbedBuilder()
    .setTitle(`${mod?.emoji.str ?? CE.settings.str} ${mod?.label ?? modId} — Settings`)
    .setColor(0x5865f2);

  switch (modId) {
    case "infractions": {
      const s = getInfractionsConfig(cfg);
      e.setDescription("Configure how infractions behave in this server.");
      e.addFields(
        {
          name: "Strike Expiry",
          value: s.strikeExpiryDays === 0 ? "*Never expire*" : `**${s.strikeExpiryDays}** days`,
          inline: true,
        },
        {
          name: "DM on Infraction",
          value: s.dmOnInfraction ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`,
          inline: true,
        },
        {
          name: "Auto-Demotion on Strikes",
          value: s.autoDemotionEnabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`,
          inline: true,
        },
        {
          name: "Punishment at 1 Active Strike",
          value: `\`${s.strikeAction1}\``,
          inline: true,
        },
        {
          name: "Punishment at 2 Active Strikes",
          value: `\`${s.strikeAction2}\``,
          inline: true,
        },
        {
          name: "Punishment at 3+ Active Strikes",
          value: `\`${s.strikeAction3plus}\``,
          inline: true,
        },
      );
      e.setFooter({ text: "Actions: none · warning · strike · demotion · termination" });
      break;
    }
    case "moderation": {
      const s = getModerationConfig(cfg);
      e.setDescription("Configure how moderation actions behave.");
      e.addFields({
        name: "DM on Action",
        value: s.dmOnAction
          ? `${CE.success.str} Enabled — users are notified when banned, kicked, muted, or jailed`
          : `${CE.error.str} Disabled — actions are silent`,
        inline: false,
      });
      break;
    }
    case "promotions": {
      const s = getPromotionsConfig(cfg);
      e.setDescription("Configure how promotion announcements are handled.");
      e.addFields({
        name: "DM Promoted Member",
        value: s.dmMember
          ? `${CE.success.str} Enabled — the promoted member receives a DM`
          : `${CE.error.str} Disabled — no DM is sent`,
        inline: false,
      });
      break;
    }
    case "demotions": {
      const s = getDemotionsConfig(cfg);
      e.setDescription("Configure how demotion announcements are handled.");
      e.addFields({
        name: "DM Demoted Member",
        value: s.dmMember
          ? `${CE.success.str} Enabled — the demoted member receives a DM`
          : `${CE.error.str} Disabled — no DM is sent`,
        inline: false,
      });
      break;
    }
    case "appeals": {
      const s = getAppealsConfig(cfg);
      e.setDescription("Configure how appeals are handled.");
      e.addFields({
        name: "Auto-Close Pending Appeals After",
        value: s.autoCloseDays === 0
          ? "*Disabled — appeals stay open until manually reviewed*"
          : `**${s.autoCloseDays}** days`,
        inline: false,
      });
      break;
    }
    case "loa": {
      const s = getLoaConfig(cfg);
      e.setDescription("Configure leave of absence handling.");
      e.addFields(
        {
          name: "Max LOA Duration",
          value: s.maxDurationDays === 0 ? "*Unlimited*" : `**${s.maxDurationDays}** days`,
          inline: true,
        },
        {
          name: "Require Reason",
          value: s.requireReason
            ? `${CE.success.str} Enabled — staff must provide a reason`
            : `${CE.error.str} Disabled — reason is optional`,
          inline: true,
        },
      );
      break;
    }
    case "staffReport": {
      const s = getStaffReportConfig(cfg);
      e.setDescription("Configure the auto-updating staff tier report.");
      e.addFields({
        name: "Refresh Interval",
        value: `Every **${s.refreshIntervalHours}** hour${s.refreshIntervalHours === 1 ? "" : "s"}`,
        inline: true,
      });
      e.setFooter({ text: "The bot checks every hour and refreshes guilds that are due." });
      break;
    }
    case "antiNuke": {
      const s = getAntiNukeConfig(cfg);
      e.setDescription("Configure anti-nuke protections for mass destructive actions.");
      e.addFields(
        {
          name: "Anti-Join Protection",
          value: s.antiJoin.enabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`,
          inline: true,
        },
        {
          name: "Anti-Ban Protection",
          value: s.antiBan.enabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`,
          inline: true,
        },
        {
          name: "Anti-Kick Protection",
          value: s.antiKick.enabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`,
          inline: true,
        },
        {
          name: "Anti-Role Protection",
          value: s.antiRole.enabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`,
          inline: true,
        },
        {
          name: "Anti-Channel Protection",
          value: s.antiChannel.enabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`,
          inline: true,
        },
        {
          name: "Common Punishment",
          value: `\`${s.commonPunishment}\``,
          inline: true,
        },
        {
          name: "Global Whitelisted Users",
          value: s.globalWhitelistUserIds.length > 0
            ? s.globalWhitelistUserIds.map((id) => `<@${id}>`).join(", ")
            : "*None configured*",
          inline: false,
        },
      );
      break;
    }
  }

  return e;
}

function settingsRows(cfg: GuildConfig, modId: string): Row[] {
  switch (modId) {
    case "infractions": {
      const s = getInfractionsConfig(cfg);
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:settings:modal:infractions")
            .setLabel(`Expiry: ${s.strikeExpiryDays === 0 ? "Never" : `${s.strikeExpiryDays}d`} · Edit Punishments`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(CE.settings.str),
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:infractions:dmOnInfraction")
            .setLabel(s.dmOnInfraction ? "DM: Enabled — Click to Disable" : "DM: Disabled — Click to Enable")
            .setStyle(s.dmOnInfraction ? ButtonStyle.Success : ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:infractions:autoDemotionEnabled")
            .setLabel(s.autoDemotionEnabled ? "Auto-Demotion: On — Click to Disable" : "Auto-Demotion: Off — Click to Enable")
            .setStyle(s.autoDemotionEnabled ? ButtonStyle.Success : ButtonStyle.Danger),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:infractions")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    case "moderation": {
      const s = getModerationConfig(cfg);
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:moderation:dmOnAction")
            .setLabel(s.dmOnAction ? "DM on Action: Enabled — Click to Disable" : "DM on Action: Disabled — Click to Enable")
            .setStyle(s.dmOnAction ? ButtonStyle.Success : ButtonStyle.Danger),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:moderation")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    case "promotions": {
      const s = getPromotionsConfig(cfg);
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:promotions:dmMember")
            .setLabel(s.dmMember ? "DM Member: Enabled — Click to Disable" : "DM Member: Disabled — Click to Enable")
            .setStyle(s.dmMember ? ButtonStyle.Success : ButtonStyle.Danger),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:promotions")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    case "demotions": {
      const s = getDemotionsConfig(cfg);
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:demotions:dmMember")
            .setLabel(s.dmMember ? "DM Member: Enabled — Click to Disable" : "DM Member: Disabled — Click to Enable")
            .setStyle(s.dmMember ? ButtonStyle.Success : ButtonStyle.Danger),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:demotions")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    case "appeals": {
      const s = getAppealsConfig(cfg);
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:settings:modal:appeals")
            .setLabel(`Auto-Close: ${s.autoCloseDays === 0 ? "Disabled" : `${s.autoCloseDays}d`}`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(CE.settings.str),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:appeals")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    case "partnership": {
      const s = getPartnershipConfig(cfg);
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:settings:modal:partnership")
            .setLabel(`Quota: ${s.quota}`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(CE.settings.str),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:partnership:setAnnounce")
            .setLabel("Set Partnership Channel")
            .setStyle(ButtonStyle.Primary)
            .setEmoji(CE.link.str),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:partnership")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    case "verify": {
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:setchannel:verify")
            .setLabel("Set Verify Channel")
            .setStyle(ButtonStyle.Primary)
            .setEmoji(CE.check.str),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:verify:sendEmbed")
            .setLabel("Send Verify Embed")
            .setStyle(ButtonStyle.Success)
            .setEmoji(CE.check.str),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:verify")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    case "loa": {
      const s = getLoaConfig(cfg);
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:settings:modal:loa")
            .setLabel(`Max Duration: ${s.maxDurationDays === 0 ? "Unlimited" : `${s.maxDurationDays}d`}`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(CE.settings.str),
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:loa:requireReason")
            .setLabel(s.requireReason ? "Require Reason: On — Click to Disable" : "Require Reason: Off — Click to Enable")
            .setStyle(s.requireReason ? ButtonStyle.Success : ButtonStyle.Danger),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:loa")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    case "antiNuke": {
      const s = getAntiNukeConfig(cfg);
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:antiNuke:antiJoins")
            .setLabel(s.antiJoin.enabled ? "Anti-Join: On" : "Anti-Join: Off")
            .setStyle(s.antiJoin.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:antiNuke:antiBans")
            .setLabel(s.antiBan.enabled ? "Anti-Ban: On" : "Anti-Ban: Off")
            .setStyle(s.antiBan.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:antiNuke:antiKicks")
            .setLabel(s.antiKick.enabled ? "Anti-Kick: On" : "Anti-Kick: Off")
            .setStyle(s.antiKick.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:antiNuke:antiRoleChanges")
            .setLabel(s.antiRole.enabled ? "Anti-Role: On" : "Anti-Role: Off")
            .setStyle(s.antiRole.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("cfg:settings:toggle:antiNuke:antiChannelChanges")
            .setLabel(s.antiChannel.enabled ? "Anti-Channel: On" : "Anti-Channel: Off")
            .setStyle(s.antiChannel.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("cfg:settings:modal:antiNuke")
            .setLabel(`Punishment: ${s.commonPunishment}`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(CE.settings.str),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:antiNuke:setUsers")
            .setLabel("Manage Whitelisted Users")
            .setStyle(ButtonStyle.Primary)
            .setEmoji(CE.admin.str),
        ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:antiNuke")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    case "staffReport": {
      const s = getStaffReportConfig(cfg);
      const sel = new StringSelectMenuBuilder()
        .setCustomId("cfg:staffReport:intervalSelect")
        .setPlaceholder("Select auto-refresh interval")
        .addOptions(
          [1, 2, 4, 6, 12, 24].map((h) => ({
            label: h === 1 ? "Every hour" : `Every ${h} hours`,
            value: String(h),
            default: s.refreshIntervalHours === h,
          })),
        );
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sel),
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("cfg:mod:view:staffReport")
            .setLabel("← Back")
            .setStyle(ButtonStyle.Secondary),
        ),
      ];
    }
    default:
      return [backRow()];
  }
}

function buildSettingsModal(cfg: GuildConfig, modId: string): ModalBuilder | null {
  switch (modId) {
    case "infractions": {
      const s = getInfractionsConfig(cfg);
      return new ModalBuilder()
        .setCustomId("cfg:settings:modalResult:infractions")
        .setTitle("Infractions Settings")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("strikeExpiryDays")
              .setLabel("Strike expiry in days (0 = never expire)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(String(s.strikeExpiryDays))
              .setPlaceholder("30"),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("strikeAction1")
              .setLabel("Punishment at 1 active strike")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(s.strikeAction1)
              .setPlaceholder("none / warning / strike / demotion / termination"),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("strikeAction2")
              .setLabel("Punishment at 2 active strikes")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(s.strikeAction2)
              .setPlaceholder("none / warning / strike / demotion / termination"),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("strikeAction3plus")
              .setLabel("Punishment at 3+ active strikes")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(s.strikeAction3plus)
              .setPlaceholder("none / warning / strike / demotion / termination"),
          ),
        );
    }
    case "appeals": {
      const s = getAppealsConfig(cfg);
      return new ModalBuilder()
        .setCustomId("cfg:settings:modalResult:appeals")
        .setTitle("Appeals Settings")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("autoCloseDays")
              .setLabel("Auto-close pending appeals after days (0 = off)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(String(s.autoCloseDays))
              .setPlaceholder("0"),
          ),
        );
    }
    case "loa": {
      const s = getLoaConfig(cfg);
      return new ModalBuilder()
        .setCustomId("cfg:settings:modalResult:loa")
        .setTitle("Leave of Absence Settings")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("maxDurationDays")
              .setLabel("Max LOA duration in days (0 = unlimited)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(String(s.maxDurationDays))
              .setPlaceholder("0"),
          ),
        );
    }
    case "partnership": {
      const s = getPartnershipConfig(cfg);
      return new ModalBuilder()
        .setCustomId("cfg:settings:modalResult:partnership")
        .setTitle("Partnership Settings")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("quota")
              .setLabel("Approved partnerships quota")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(String(s.quota))
              .setPlaceholder("0"),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("failureAction1")
              .setLabel("1st failure action")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(String(s.failureActions[1]))
              .setPlaceholder("none"),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("failureAction2")
              .setLabel("2nd failure action")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(String(s.failureActions[2]))
              .setPlaceholder("none"),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("failureAction3")
              .setLabel("3rd failure action")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(String(s.failureActions[3]))
              .setPlaceholder("none"),
          ),
        );
    }
    case "antiNuke": {
      const s = getAntiNukeConfig(cfg);
      return new ModalBuilder()
        .setCustomId("cfg:settings:modalResult:antiNuke")
        .setTitle("Anti-Nuke Common Punishment")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("punishmentAction")
              .setLabel("Common punishment for anti-nuke protection")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(s.commonPunishment)
              .setPlaceholder("none / kick / ban / timeout_1h / timeout_24h / timeout_7d"),
          ),
        );
    }
    case "quotaFailure": {
      const s = getQuotaFailureConfig(cfg);
      return new ModalBuilder()
        .setCustomId("cfg:quotaFailureModalResult")
        .setTitle("Quota Failure Punishments")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("failure1")
              .setLabel("Punishment on 1st consecutive missed week")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(s.failure1)
              .setPlaceholder("none / warning / strike / demotion / termination"),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("failure2")
              .setLabel("Punishment on 2nd consecutive missed week")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(s.failure2)
              .setPlaceholder("none / warning / strike / demotion / termination"),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("failure3plus")
              .setLabel("Punishment on 3rd+ consecutive missed week")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(s.failure3plus)
              .setPlaceholder("none / warning / strike / demotion / termination"),
          ),
        );
    }
    default:
      return null;
  }
}

function buildAntiNukeUsersModal(cfg: GuildConfig): ModalBuilder {
  const s = getAntiNukeConfig(cfg);
  return new ModalBuilder()
    .setCustomId("cfg:antiNuke:usersModalResult")
    .setTitle("Anti-Nuke Global Whitelist Users")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("whitelistedUserIds")
          .setLabel("Global user IDs that bypass anti-nuke checks")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(s.globalWhitelistUserIds.join(", "))
          .setPlaceholder("123456789012345678, 987654321098765432"),
      ),
    );
}

// ── Prefix view ───────────────────────────────────────────────────────────────

function buildPrefixEmbed(cfg: GuildConfig): EmbedBuilder {
  const prefix = cfg.guildPrefix ?? "b?";
  return new EmbedBuilder()
    .setTitle(`${CE.settings.str} Custom Prefix`)
    .setColor(0x5865f2)
    .setDescription(
      "Set a custom command prefix for this server.\n" +
      "Only the DM broadcast command is affected — nuke and highfi are always `bp?`.",
    )
    .addFields(
      { name: "Current Prefix", value: `\`${prefix}\``, inline: true },
      { name: "DM Command", value: `\`${prefix}n\``, inline: true },
      { name: "Always Fixed", value: "`bp?nuke`  ·  `bp?highfi`", inline: true },
    );
}

function prefixRows(cfg: GuildConfig): Row[] {
  const prefix = cfg.guildPrefix ?? "b?";
  const isDefault = !cfg.guildPrefix || cfg.guildPrefix === "b?";
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:prefix:set")
        .setLabel(`Set Prefix (current: ${prefix})`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji(CE.settings.str),
      new ButtonBuilder()
        .setCustomId("cfg:prefix:reset")
        .setLabel("Reset to Default (b?)")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(isDefault),
    ),
    backRow(),
  ];
}

function prefixModal(cfg: GuildConfig): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("cfg:prefix:modal")
    .setTitle("Set Custom Prefix")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("prefix")
          .setLabel("Command prefix (1–10 characters)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(10)
          .setValue(cfg.guildPrefix ?? "b?")
          .setPlaceholder("b?"),
      ),
    );
}

// ── Bot Profile view ──────────────────────────────────────────────────────────

function buildBotProfileEmbed(nickname: string | null, avatarUrl: string, note?: string): EmbedBuilder {
  const e = new EmbedBuilder()
    .setTitle(`${CE.admin.str} Bot Profile — This Server`)
    .setColor(0x5865f2)
    .setThumbnail(avatarUrl || null)
    .setDescription(
      note ??
      "Change the bot's display name for this server only.\n" +
      "Avatar cannot be set per server from this menu.\n\n" +
      "Tip: use `/setavatar` to update the global bot avatar instead.",
    )
    .addFields({
      name: "Current Nickname",
      value: nickname ? `**${nickname}**` : "*None — using global bot name*",
      inline: true,
    });
  return e;
}

function botProfileRows(): Row[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:botProfile:set")
        .setLabel("Change Nickname / Avatar")
        .setStyle(ButtonStyle.Primary)
        .setEmoji(CE.admin.str),
      new ButtonBuilder()
        .setCustomId("cfg:botProfile:resetNickname")
        .setLabel("Reset Nickname")
        .setStyle(ButtonStyle.Secondary),
    ),
    backRow(),
  ];
}

function botProfileModal(currentNick: string | null): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("cfg:botProfile:modal")
    .setTitle("Change Bot Profile")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("nickname")
          .setLabel("Server Nickname (blank = clear)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(32)
          .setValue(currentNick ?? "")
          .setPlaceholder("Relosta Bot"),
      ),
    );
}

// ── Quota-specific builders ───────────────────────────────────────────────────

function buildQuotaEmbed(c: GuildConfig): EmbedBuilder {
  const e = new EmbedBuilder().setTitle("Quota Configuration").setColor(0x5865f2);
  if (c.quotaConfig) {
    e.addFields(
      { name: "Global — Messages / week", value: String(c.quotaConfig.messages), inline: true },
      { name: "Global — Mod actions / week", value: String(c.quotaConfig.modActions), inline: true },
      { name: "Week starts on", value: WEEKDAYS[c.quotaConfig.weekStartDay] ?? "Sunday", inline: true },
    );
    const rqEntries = Object.entries(c.roleQuotas ?? {});
    if (rqEntries.length > 0) {
      e.addFields({
        name: `${CE.settings.str} Per-Role Overrides`,
        value: rqEntries
          .map(([roleId, rq]) => `<@&${roleId}>: **${rq.messages}** msgs / **${rq.modActions}** mod actions`)
          .join("\n"),
        inline: false,
      });
    }
    const wl = c.quotaWhitelistRoles ?? [];
    e.addFields({
      name: `${CE.error.str} Quota Whitelist (exempt from check)`,
      value: wl.length > 0 ? wl.map((r) => `<@&${r}>`).join(", ") : "*None — all staff are checked*",
      inline: false,
    });
  } else {
    e.setDescription("Quota is **not configured**. Press *Set Targets* to define weekly goals.");
  }
  // Always show failure punishment configuration
  const qf = getQuotaFailureConfig(c);
  e.addFields({
    name: `${CE.warning.str} Consecutive Miss Punishments`,
    value: [
      `**1st miss:** \`${qf.failure1}\``,
      `**2nd miss:** \`${qf.failure2}\``,
      `**3rd+ miss:** \`${qf.failure3plus}\``,
    ].join("\n"),
    inline: false,
  });
  return e;
}

function quotaRows(c: GuildConfig): Row[] {
  const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:quotaSet")
      .setLabel(c.quotaConfig ? "Edit Targets" : "Set Targets")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cfg:quotaDay")
      .setLabel("Week Start Day")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!c.quotaConfig),
    new ButtonBuilder()
      .setCustomId("cfg:quotaRoleTarget")
      .setLabel("Per-Role Targets")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.staff.str)
      .setDisabled(!c.quotaConfig),
    new ButtonBuilder()
      .setCustomId("cfg:quotaClear")
      .setLabel("Clear Quota")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!c.quotaConfig),
  );
  const row2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:quotaWhitelist")
      .setLabel("Manage Whitelist")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.admin.str)
      .setDisabled(!c.quotaConfig),
    new ButtonBuilder()
      .setCustomId("cfg:quotaFailurePunishments")
      .setLabel("Failure Punishments")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(CE.warning.str),
  );
  return [row1, row2, backRow()];
}

function whitelistManageRows(c: GuildConfig, roleNameMap: Map<string, string>): Row[] {
  const addSel = new RoleSelectMenuBuilder()
    .setCustomId("cfg:quotaWhitelistAdd")
    .setPlaceholder("Add roles to quota whitelist (exempt from Friday check)")
    .setMinValues(1)
    .setMaxValues(10);

  const wl = c.quotaWhitelistRoles ?? [];
  const rmSel = new StringSelectMenuBuilder()
    .setCustomId("cfg:quotaWhitelistRemove")
    .setPlaceholder("Remove a role from the whitelist")
    .setMinValues(1)
    .setMaxValues(1);

  if (wl.length > 0) {
    rmSel.addOptions(
      wl.slice(0, 25).map((r) => ({
        label: roleNameMap.get(r) ?? `Role ${r}`,
        value: r,
        description: `ID: ${r}`,
      })),
    );
  } else {
    rmSel.addOptions({ label: "(whitelist is empty)", value: "_noop", default: true }).setDisabled(true);
  }

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(addSel),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(rmSel),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:quotaWhitelistClearAll")
        .setLabel("Clear All")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(wl.length === 0),
      new ButtonBuilder()
        .setCustomId("cfg:mod:view:quota")
        .setLabel("← Back")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function roleQuotaPickRows(): Row[] {
  const sel = new RoleSelectMenuBuilder()
    .setCustomId("cfg:quotaRoleSelect")
    .setPlaceholder("Select a role to set its quota target")
    .setMinValues(1)
    .setMaxValues(1);
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sel),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:mod:view:quota")
        .setLabel("← Back")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function roleQuotaModal(role: Role, existing?: RoleQuota): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`cfg:quotaRoleModal:${role.id}`)
    .setTitle(`Quota for @${role.name}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("messages")
          .setLabel("Messages per week for this role")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(existing?.messages ?? 50)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("modActions")
          .setLabel("Mod actions per week for this role")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(existing?.modActions ?? 5)),
      ),
    );
}

function weekStartRows(c: GuildConfig): Row[] {
  const sel = new StringSelectMenuBuilder()
    .setCustomId("cfg:quotaDaySet")
    .setPlaceholder("Pick the day the week starts on")
    .addOptions(
      WEEKDAYS.map((day, i) => ({
        label: day,
        value: String(i),
        default: c.quotaConfig?.weekStartDay === i,
      })),
    );
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sel),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:mod:view:quota")
        .setLabel("← Back")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function quotaModal(c: GuildConfig): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("cfg:quotaModal")
    .setTitle("Set Weekly Quota Targets")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("messages")
          .setLabel("Messages per week")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(c.quotaConfig?.messages ?? 50)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("modActions")
          .setLabel("Mod actions per week")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(c.quotaConfig?.modActions ?? 5)),
      ),
    );
}

// ── Staff roles view ──────────────────────────────────────────────────────────

async function staffRolesView(guildId: string): Promise<{ embed: EmbedBuilder; rows: Row[] }> {
  const roles = await listStaffRoles(guildId);
  const embed = new EmbedBuilder()
    .setTitle("Staff Roles")
    .setColor(0x5865f2)
    .setDescription(
      roles.length === 0
        ? "*No staff roles registered yet.* Use the picker below to add one."
        : roles.map((r) => `**${r.position}.** <@&${r.roleId}>`).join("\n"),
    );

  const addSel = new RoleSelectMenuBuilder()
    .setCustomId("cfg:staffRoleAdd")
    .setPlaceholder("Add a staff role")
    .setMinValues(1)
    .setMaxValues(1);

  const rmSel = new StringSelectMenuBuilder()
    .setCustomId("cfg:staffRoleRemove")
    .setPlaceholder("Remove a staff role")
    .setMinValues(1)
    .setMaxValues(1);

  if (roles.length > 0) {
    rmSel.addOptions(
      roles.slice(0, 25).map((r) => ({
        label: `Position #${r.position}`,
        value: r.roleId,
        description: r.roleId,
      })),
    );
  } else {
    rmSel.addOptions({ label: "(no roles)", value: "_noop", default: true }).setDisabled(true);
  }

  return {
    embed,
    rows: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(addSel),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(rmSel),
      backRow(),
    ],
  };
}

// ── Anti-Nuke UI ──────────────────────────────────────────────────────────────

const AN_PUNISHMENT_LABELS: Record<AntiNukePunishment, string> = {
  none: "None (log only)",
  kick: "Kick",
  ban: "Ban",
  timeout_1h: "Timeout 1 hour",
  timeout_24h: "Timeout 24 hours",
  timeout_7d: "Timeout 7 days",
};

const AN_MINI_LABELS: Record<AntiNukeMiniId, { label: string; description: string }> = {
  antiJoin:    { label: "Anti-Join",    description: "Punish users who repeatedly join/leave the server." },
  antiBan:     { label: "Anti-Ban",     description: "Punish users who issue unauthorized bans." },
  antiKick:    { label: "Anti-Kick",    description: "Punish users who issue unauthorized kicks." },
  antiRole:    { label: "Anti-Role",    description: "Punish dangerous role creation/deletion/assignment." },
  antiChannel: { label: "Anti-Channel", description: "Punish unauthorized channel creation or deletion." },
};

function buildAntiNukeOverviewEmbed(cfg: GuildConfig): EmbedBuilder {
  const an = getAntiNukeConfig(cfg);
  const st = (b: boolean) => (b ? CE.success.str : CE.error.str);
  const lines = [
    `${st(an.antiJoin.enabled)} **Anti-Join** — Threshold: **${an.antiJoin.threshold}** joins in **${an.antiJoin.windowSeconds}s** · Punishment: \`${an.antiJoin.punishment}\``,
    `${st(an.antiBan.enabled)} **Anti-Ban** · Punishment: \`${an.antiBan.punishment}\``,
    `${st(an.antiKick.enabled)} **Anti-Kick** · Punishment: \`${an.antiKick.punishment}\``,
    `${st(an.antiRole.enabled)} **Anti-Role** · Punishment: \`${an.antiRole.punishment}\``,
    `${st(an.antiChannel.enabled)} **Anti-Channel** · Punishment: \`${an.antiChannel.punishment}\``,
  ];
  const e = new EmbedBuilder()
    .setTitle(`${CE.termination.str} Anti-Nuke`)
    .setColor(an.enabled ? 0x57f287 : 0xed4245)
    .addFields(
      { name: `Status`, value: an.enabled ? `${CE.success.str} **Enabled**` : `${CE.error.str} **Disabled**`, inline: true },
      { name: `${CE.warning.str} Common Punishment`, value: `\`${an.commonPunishment}\``, inline: true },
    )
    .setDescription(lines.join("\n"));
  if (an.accessUserIds.length > 0) {
    e.addFields({
      name: `${CE.admin.str} Extra Access Users`,
      value: an.accessUserIds.slice(0, 10).map((id) => `<@${id}>`).join(", "),
      inline: false,
    });
  }
  const wlParts: string[] = [];
  if (an.globalWhitelistUserIds.length > 0) wlParts.push(an.globalWhitelistUserIds.slice(0, 5).map((id) => `<@${id}>`).join(", "));
  if (an.globalWhitelistRoleIds.length > 0) wlParts.push(an.globalWhitelistRoleIds.slice(0, 5).map((id) => `<@&${id}>`).join(", "));
  if (wlParts.length > 0) {
    e.addFields({ name: `${CE.members.str} Global Whitelist`, value: wlParts.join(" · "), inline: false });
  }
  const logCh = cfg.channels.antiNukeLog;
  e.addFields({
    name: `${CE.settings.str} Log Channel`,
    value: logCh ? `<#${logCh}>` : "*Not set* — trigger events won't be logged",
    inline: false,
  });
  e.setFooter({ text: "Access: global whitelist · roles above bot · extra access users" });
  return e;
}

function antiNukeOverviewRows(cfg: GuildConfig): Row[] {
  const an = getAntiNukeConfig(cfg);
  const miniSel = new StringSelectMenuBuilder()
    .setCustomId("cfg:an:miniSelect")
    .setPlaceholder("Select a mini-module to configure")
    .addOptions(
      (Object.keys(AN_MINI_LABELS) as AntiNukeMiniId[]).map((id) => ({
        label: AN_MINI_LABELS[id].label,
        value: id,
        description: AN_MINI_LABELS[id].description,
      })),
    );
  const row2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:an:toggle")
      .setLabel(an.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable")
      .setStyle(an.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("cfg:an:enableAll")
      .setLabel("Enable All")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cfg:an:disableAll")
      .setLabel("Disable All")
      .setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:an:access")
      .setLabel("Access Control")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.admin.str),
    new ButtonBuilder()
      .setCustomId("cfg:an:globalWL")
      .setLabel("Global Whitelist")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.members.str),
    new ButtonBuilder()
      .setCustomId("cfg:an:commonPunish")
      .setLabel("Common Punishment")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(CE.warning.str),
    new ButtonBuilder()
      .setCustomId("cfg:an:setLogChannel")
      .setLabel(cfg.channels.antiNukeLog ? "Change Log Channel" : "Set Log Channel")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(CE.settings.str),
  );
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(miniSel),
    row2,
    row3,
    backRow(),
  ];
}

function buildAntiNukeMiniEmbed(cfg: GuildConfig, miniId: AntiNukeMiniId): EmbedBuilder {
  const an = getAntiNukeConfig(cfg);
  const mini = an[miniId];
  const info = AN_MINI_LABELS[miniId];
  const e = new EmbedBuilder()
    .setTitle(`${CE.termination.str} Anti-Nuke · ${info.label}`)
    .setColor(mini.enabled ? 0x57f287 : 0xed4245)
    .addFields(
      { name: "Status", value: mini.enabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`, inline: true },
      { name: "Punishment", value: `\`${mini.punishment}\``, inline: true },
    );
  if (miniId === "antiJoin") {
    const aj = an.antiJoin;
    e.addFields(
      { name: "Join Threshold", value: `**${aj.threshold}** joins`, inline: true },
      { name: "Time Window", value: `**${aj.windowSeconds}** seconds`, inline: true },
    );
  }
  const wlParts: string[] = [];
  if (mini.whitelistUserIds.length > 0) wlParts.push(mini.whitelistUserIds.slice(0, 5).map((id) => `<@${id}>`).join(", "));
  if (mini.whitelistRoleIds.length > 0) wlParts.push(mini.whitelistRoleIds.slice(0, 5).map((id) => `<@&${id}>`).join(", "));
  e.addFields({
    name: `${CE.members.str} Module Whitelist`,
    value: wlParts.length > 0 ? wlParts.join(" · ") : "*None*",
    inline: false,
  });
  return e;
}

function antiNukeMiniRows(cfg: GuildConfig, miniId: AntiNukeMiniId): Row[] {
  const an = getAntiNukeConfig(cfg);
  const mini = an[miniId];
  const punishSel = new StringSelectMenuBuilder()
    .setCustomId(`cfg:an:mini:punish:${miniId}`)
    .setPlaceholder("Set punishment for this module")
    .addOptions(
      (Object.entries(AN_PUNISHMENT_LABELS) as [AntiNukePunishment, string][]).map(([value, label]) => ({
        label,
        value,
        default: mini.punishment === value,
      })),
    );
  const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cfg:an:mini:toggle:${miniId}`)
      .setLabel(mini.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable")
      .setStyle(mini.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
  );
  if (miniId === "antiJoin") {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:an:mini:joinThreshold")
        .setLabel("Set Threshold / Window")
        .setStyle(ButtonStyle.Primary)
        .setEmoji(CE.settings.str),
    );
  }
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(punishSel),
    actionRow,
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`cfg:an:mini:wlUser:${miniId}`)
        .setPlaceholder("Add users to this module's whitelist")
        .setMinValues(1)
        .setMaxValues(10),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`cfg:an:mini:wlRole:${miniId}`)
        .setPlaceholder("Add roles to this module's whitelist")
        .setMinValues(1)
        .setMaxValues(10),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cfg:an:mini:wlClear:${miniId}`)
        .setLabel("Clear Module Whitelist")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cfg:an:overview")
        .setLabel("← Anti-Nuke")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildAntiNukeAccessEmbed(cfg: GuildConfig): EmbedBuilder {
  const an = getAntiNukeConfig(cfg);
  return new EmbedBuilder()
    .setTitle(`${CE.admin.str} Anti-Nuke · Access Control`)
    .setColor(0x5865f2)
    .setDescription(
      "These users can open the Anti-Nuke config panel even without a role above the bot.\n" +
      "**Global whitelist members and users with roles above the bot always have access.**",
    )
    .addFields({
      name: "Extra Access Users",
      value: an.accessUserIds.length > 0
        ? an.accessUserIds.map((id) => `<@${id}>`).join(", ")
        : "*None — only global whitelist + roles above bot*",
      inline: false,
    });
}

function antiNukeAccessRows(cfg: GuildConfig): Row[] {
  const an = getAntiNukeConfig(cfg);
  const rmSel = new StringSelectMenuBuilder()
    .setCustomId("cfg:an:accessRemove")
    .setPlaceholder("Remove a user from Anti-Nuke access")
    .setMinValues(1)
    .setMaxValues(1);
  if (an.accessUserIds.length > 0) {
    rmSel.addOptions(an.accessUserIds.slice(0, 25).map((id) => ({ label: `User ${id}`, value: id, description: id })));
  } else {
    rmSel.addOptions({ label: "(no extra users)", value: "_noop", default: true }).setDisabled(true);
  }
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("cfg:an:accessAdd")
        .setPlaceholder("Add users to Anti-Nuke access")
        .setMinValues(1)
        .setMaxValues(10),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(rmSel),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:an:overview")
        .setLabel("← Anti-Nuke")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildAntiNukeGlobalWLEmbed(cfg: GuildConfig): EmbedBuilder {
  const an = getAntiNukeConfig(cfg);
  return new EmbedBuilder()
    .setTitle(`${CE.members.str} Anti-Nuke · Global Whitelist`)
    .setColor(0x5865f2)
    .setDescription("Users and roles here are exempt from **all** anti-nuke actions.")
    .addFields(
      {
        name: "Whitelisted Users",
        value: an.globalWhitelistUserIds.length > 0
          ? an.globalWhitelistUserIds.map((id) => `<@${id}>`).join(", ")
          : "*None*",
        inline: false,
      },
      {
        name: "Whitelisted Roles",
        value: an.globalWhitelistRoleIds.length > 0
          ? an.globalWhitelistRoleIds.map((id) => `<@&${id}>`).join(", ")
          : "*None*",
        inline: false,
      },
    );
}

function antiNukeGlobalWLRows(): Row[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("cfg:an:gwlAddUser")
        .setPlaceholder("Add users to global whitelist")
        .setMinValues(1)
        .setMaxValues(10),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("cfg:an:gwlAddRole")
        .setPlaceholder("Add roles to global whitelist")
        .setMinValues(1)
        .setMaxValues(10),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("cfg:an:gwlClearUsers")
        .setLabel("Clear Users")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cfg:an:gwlClearRoles")
        .setLabel("Clear Roles")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cfg:an:overview")
        .setLabel("← Anti-Nuke")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── Tickets UI ────────────────────────────────────────────────────────────────

function buildTicketsOverviewEmbed(tc: TicketsModuleConfig): EmbedBuilder {
  const panelList = Object.values(tc.panels);
  const mp = tc.multiPanel;
  const mpValue = mp
    ? `${mp.panelIds.length} panels · ${mp.useButtons ? "Buttons" : "Dropdown"} · ${mp.channelId ? `<#${mp.channelId}>` : "no channel"}`
    : "*Not configured*";
  return new EmbedBuilder()
    .setTitle(`${CE.ticket.str} Tickets Module`)
    .setColor(tc.enabled ? 0x57f287 : 0xed4245)
    .addFields(
      { name: "Status", value: tc.enabled ? `${CE.check_yes.str} Enabled` : `${CE.check_no.str} Disabled`, inline: true },
      { name: "Panels", value: `**${panelList.length}**`, inline: true },
      { name: "Support Role", value: tc.supportRoleId ? `<@&${tc.supportRoleId}>` : "*Not set*", inline: true },
      { name: "Admin Role", value: tc.adminRoleId ? `<@&${tc.adminRoleId}>` : "*Not set*", inline: true },
      { name: "Log Channel", value: tc.logChannelId ? `<#${tc.logChannelId}>` : "*Not set*", inline: true },
      { name: "Transcript Channel", value: tc.transcriptChannelId ? `<#${tc.transcriptChannelId}>` : "*Not set*", inline: true },
      { name: "Multi-Panel", value: mpValue, inline: false },
      { name: `${CE.clipboard.str} Panels`, value: panelList.length > 0 ? panelList.map((p) => `• **${p.name}** — \`${p.buttonLabel}\``).join("\n") : "*No panels yet.*", inline: false },
    )
    .setFooter({ text: "Ticket numbering: {panel-name}-001, 002, ..." });
}

function ticketsOverviewRows(tc: TicketsModuleConfig): Row[] {
  const rows: Row[] = [];
  rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cfg:tickets:toggle").setLabel(tc.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable").setStyle(tc.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("cfg:tickets:addPanel").setLabel("Add Panel").setStyle(ButtonStyle.Primary).setEmoji({ id: CE.ticket.id, name: CE.ticket.name, animated: CE.ticket.animated }),
    new ButtonBuilder().setCustomId("cfg:tickets:multiPanel").setLabel(tc.multiPanel ? "Edit Multi-Panel" : "Multi-Panel").setStyle(ButtonStyle.Secondary).setEmoji("📋"),
  ));
  rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cfg:tickets:setSupportRole").setLabel("Set Support Role").setStyle(ButtonStyle.Secondary).setEmoji({ id: CE.members.id, name: CE.members.name, animated: CE.members.animated }),
    new ButtonBuilder().setCustomId("cfg:tickets:setAdminRole").setLabel("Set Admin Role").setStyle(ButtonStyle.Secondary).setEmoji({ id: CE.admin.id, name: CE.admin.name, animated: CE.admin.animated }),
    new ButtonBuilder().setCustomId("cfg:tickets:setLogChannel").setLabel(tc.logChannelId ? "Change Log Channel" : "Set Log Channel").setStyle(ButtonStyle.Secondary).setEmoji({ id: CE.clipboard.id, name: CE.clipboard.name, animated: CE.clipboard.animated }),
    new ButtonBuilder().setCustomId("cfg:tickets:setTranscriptChannel").setLabel(tc.transcriptChannelId ? "Change Transcript" : "Set Transcript Channel").setStyle(ButtonStyle.Secondary).setEmoji({ id: CE.information.id, name: CE.information.name, animated: CE.information.animated }),
  ));
  const panelList = Object.values(tc.panels);
  if (panelList.length > 0) {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId("cfg:tickets:panelSelect").setPlaceholder("Select a panel to configure").addOptions(
        panelList.slice(0, 25).map((p) => ({ label: p.name.slice(0, 25), value: p.id, description: `Button: ${p.buttonLabel.slice(0, 50)}` })),
      ),
    ));
  }
  rows.push(backRow());
  return rows;
}

function buildMultiPanelEmbed(tc: TicketsModuleConfig): EmbedBuilder {
  const mp = tc.multiPanel;
  if (!mp) {
    return new EmbedBuilder()
      .setTitle("📋 Multi-Panel")
      .setColor(0x5865f2)
      .setDescription("No multi-panel configured yet.\n\nA multi-panel groups multiple ticket panels into **one embed**, displayed as **buttons** or a **dropdown menu**. Users pick a category and the matching ticket opens.");
  }
  const panels = Object.values(tc.panels);
  const includedNames = mp.panelIds.map((id) => panels.find((p) => p.id === id)?.name ?? id);
  return new EmbedBuilder()
    .setTitle("📋 Multi-Panel Config")
    .setColor(0x5865f2)
    .addFields(
      { name: "Embed Title", value: mp.embedTitle || "*Not set*", inline: true },
      { name: "Display Style", value: mp.useButtons ? "🔘 Buttons" : "📑 Dropdown", inline: true },
      { name: "Channel", value: mp.channelId ? `<#${mp.channelId}>` : "*Not set*", inline: true },
      { name: `Included Panels (${mp.panelIds.length})`, value: includedNames.length > 0 ? includedNames.map((n) => `• ${n}`).join("\n") : "*None selected — use the dropdown below*", inline: false },
      { name: "Embed Description", value: mp.embedDescription || "*Not set*", inline: false },
    )
    .setFooter({ text: mp.messageId ? "Posted — use Re-Post to apply changes" : "Not posted yet" });
}

function multiPanelRows(tc: TicketsModuleConfig): Row[] {
  const mp = tc.multiPanel;
  const panelList = Object.values(tc.panels);
  const rows: Row[] = [];
  if (!mp) {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId("cfg:tickets:multiPanel:create").setLabel("Create Multi-Panel").setStyle(ButtonStyle.Success).setEmoji("📋"),
    ));
  } else {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId("cfg:tickets:multiPanel:editEmbed").setLabel("Edit Embed").setStyle(ButtonStyle.Primary).setEmoji({ id: CE.information.id, name: CE.information.name, animated: CE.information.animated }),
      new ButtonBuilder().setCustomId("cfg:tickets:multiPanel:toggleStyle").setLabel(mp.useButtons ? "Switch to Dropdown" : "Switch to Buttons").setStyle(ButtonStyle.Secondary).setEmoji(mp.useButtons ? "📑" : "🔘"),
      new ButtonBuilder().setCustomId("cfg:tickets:multiPanel:setChannel").setLabel(mp.channelId ? "Change Channel" : "Set Channel").setStyle(ButtonStyle.Secondary).setEmoji({ id: CE.announce.id, name: CE.announce.name, animated: CE.announce.animated }),
    ));
    if (panelList.length > 0) {
      rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("cfg:tickets:multiPanel:setPanelsRes")
          .setPlaceholder("Pick panels to include in the multi-panel…")
          .setMinValues(1)
          .setMaxValues(Math.min(panelList.length, 25))
          .addOptions(
            panelList.slice(0, 25).map((p) => ({
              label: p.buttonLabel.slice(0, 25),
              value: p.id,
              description: `Panel: ${p.name.slice(0, 50)}`,
              default: mp.panelIds.includes(p.id),
            })),
          ),
      ));
    }
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId("cfg:tickets:multiPanel:post").setLabel(mp.messageId ? "Re-Post Multi-Panel" : "Post Multi-Panel").setStyle(ButtonStyle.Success).setEmoji({ id: CE.success.id, name: CE.success.name, animated: CE.success.animated }),
      new ButtonBuilder().setCustomId("cfg:tickets:multiPanel:delete").setLabel("Delete Multi-Panel").setStyle(ButtonStyle.Danger).setEmoji({ id: CE.trash.id, name: CE.trash.name, animated: CE.trash.animated }),
    ));
  }
  rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cfg:tickets:overview").setLabel("← Back to Tickets").setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

function buildTicketPanelEmbed(panel: TicketPanel): EmbedBuilder {
  const questionsText = panel.questions && panel.questions.length > 0
    ? panel.questions.map((q, i) => `**${i + 1}.** ${q.label} *(${q.style}, ${q.required ? "required" : "optional"})*`).join("\n")
    : "*No questions — ticket opens immediately.*";
  return new EmbedBuilder()
    .setTitle(`${CE.ticket.str} Panel — ${panel.name}`)
    .setColor(panel.embedColor || 0x5865f2)
    .addFields(
      { name: "Embed Title", value: panel.embedTitle || "*Not set*", inline: true },
      { name: "Button Label", value: panel.buttonLabel, inline: true },
      { name: "Button Emoji", value: panel.buttonEmoji || "*None*", inline: true },
      { name: "Support Role", value: panel.supportRoleId ? `<@&${panel.supportRoleId}>` : "*Uses global setting*", inline: true },
      { name: "Category", value: panel.categoryId ? `<#${panel.categoryId}>` : "*Root of server*", inline: true },
      { name: "Panel Channel", value: panel.panelChannelId ? `<#${panel.panelChannelId}>` : "*Not posted*", inline: true },
      { name: "Embed Description", value: panel.embedDescription ? panel.embedDescription.slice(0, 200) : "*Not set*", inline: false },
      { name: `Pre-Ticket Questions (${panel.questions?.length ?? 0}/5)`, value: questionsText, inline: false },
    )
    .setFooter({ text: `Panel ID: ${panel.id}` });
}

function buildPanelQuestionsEmbed(panel: TicketPanel): EmbedBuilder {
  const qs = panel.questions ?? [];
  const desc = qs.length > 0
    ? qs.map((q, i) => `**${i + 1}.** ${q.label}\n> Style: \`${q.style}\` · ${q.required ? "Required" : "Optional"}`).join("\n\n")
    : "*No questions configured yet.*\n\nAdd up to 5 questions. Users will answer them in a pop-up form before the ticket channel is created.";
  return new EmbedBuilder()
    .setTitle(`${CE.ticket.str} Pre-Ticket Questions — ${panel.name}`)
    .setColor(panel.embedColor || 0x5865f2)
    .setDescription(desc)
    .setFooter({ text: `${qs.length}/5 questions · Changes take effect on the next ticket opened` });
}

function panelQuestionsRows(panel: TicketPanel): Row[] {
  const qs = panel.questions ?? [];
  const rows: Row[] = [];
  if (qs.length < 5) {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`cfg:tickets:panel:addQuestion:${panel.id}`).setLabel("Add Question").setStyle(ButtonStyle.Success).setEmoji("➕"),
    ));
  }
  if (qs.length > 0) {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      ...qs.map((q, i) =>
        new ButtonBuilder()
          .setCustomId(`cfg:tickets:panel:removeQuestion:${panel.id}:${i}`)
          .setLabel(`Remove #${i + 1}: ${q.label.slice(0, 20)}`)
          .setStyle(ButtonStyle.Danger),
      ),
    ));
  }
  rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`cfg:tickets:panel:view:${panel.id}`).setLabel("← Back to Panel").setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

function ticketPanelRows(panel: TicketPanel): Row[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`cfg:tickets:panel:editEmbed:${panel.id}`).setLabel("Edit Embed & Button").setStyle(ButtonStyle.Primary).setEmoji({ id: CE.information.id, name: CE.information.name, animated: CE.information.animated }),
      new ButtonBuilder().setCustomId(`cfg:tickets:panel:setSupportRole:${panel.id}`).setLabel("Override Support Role").setStyle(ButtonStyle.Secondary).setEmoji({ id: CE.members.id, name: CE.members.name, animated: CE.members.animated }),
      new ButtonBuilder().setCustomId(`cfg:tickets:panel:setCategory:${panel.id}`).setLabel("Set Category").setStyle(ButtonStyle.Secondary).setEmoji({ id: CE.folder.id, name: CE.folder.name, animated: CE.folder.animated }),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`cfg:tickets:panel:questions:${panel.id}`).setLabel(`Questions (${panel.questions?.length ?? 0}/5)`).setStyle(ButtonStyle.Secondary).setEmoji("❓"),
      new ButtonBuilder().setCustomId(`cfg:tickets:panel:setChannel:${panel.id}`).setLabel("Set Panel Channel").setStyle(ButtonStyle.Secondary).setEmoji({ id: CE.announce.id, name: CE.announce.name, animated: CE.announce.animated }),
      new ButtonBuilder().setCustomId(`cfg:tickets:panel:post:${panel.id}`).setLabel(panel.panelMessageId ? "Re-Post Panel" : "Post Panel").setStyle(ButtonStyle.Success).setEmoji({ id: CE.success.id, name: CE.success.name, animated: CE.success.animated }),
      new ButtonBuilder().setCustomId(`cfg:tickets:panel:delete:${panel.id}`).setLabel("Delete Panel").setStyle(ButtonStyle.Danger).setEmoji({ id: CE.trash.id, name: CE.trash.name, animated: CE.trash.animated }),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId("cfg:tickets:overview").setLabel("← Back to Tickets").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── Automod UI ────────────────────────────────────────────────────────────────


// ── Levels config embed & rows ───────────────────────────────────────────────

function buildLevelsEmbed(lc: LevelConfig): EmbedBuilder {
  const rolesText = lc.levelRoles.length > 0
    ? lc.levelRoles
        .sort((a, b) => a.level - b.level)
        .map((r) => `Level ${r.level} → <@&${r.roleId}>`)
        .join("\n")
    : "None configured";

  const ignoredChText = lc.ignoredChannels.length > 0
    ? lc.ignoredChannels.map((c) => `<#${c}>`).join(", ")
    : "None";

  const allowedChText = lc.allowedChannels.length > 0
    ? lc.allowedChannels.map((c) => `<#${c}>`).join(", ")
    : "All channels";

  const ignoredRolesText = lc.ignoredRoles.length > 0
    ? lc.ignoredRoles.map((r) => `<@&${r}>`).join(", ")
    : "None";

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${CE.trophy.str} Levels — Config`)
    .addFields(
      { name: "Status", value: lc.enabled ? `${CE.success.str} Enabled` : `${CE.error.str} Disabled`, inline: true },
      { name: "Level Limit", value: lc.levelLimit !== null ? String(lc.levelLimit) : "No limit", inline: true },
      { name: "Stack Roles", value: lc.stackRoles ? "Yes (keep all)" : "No (replace)", inline: true },
      { name: "XP per Message", value: `${lc.xpPerMessageMin}–${lc.xpPerMessageMax} XP`, inline: true },
      { name: "Cooldown", value: `${lc.xpCooldownSeconds}s`, inline: true },
      { name: "XP per VC Minute", value: `${lc.xpPerVcMinute} XP`, inline: true },
      { name: "Level-Up Announce", value: lc.levelUpAnnounce ? "On" : "Off", inline: true },
      { name: "Level-Up Channel", value: lc.levelUpChannel ? `<#${lc.levelUpChannel}>` : "Same as message", inline: true },
      { name: "Allowed Channels", value: allowedChText, inline: false },
      { name: "Ignored Channels", value: ignoredChText, inline: false },
      { name: "Ignored Roles", value: ignoredRolesText, inline: false },
      { name: "Level Roles", value: rolesText, inline: false },
      { name: "Level-Up Message", value: `\`${lc.embedMessage}\``, inline: false },
    )
    .setFooter({ text: "Use {user} and {level} as placeholders in the message." });
}

function levelsRows(lc: LevelConfig): Row[] {
  const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cfg:levels:toggle")
      .setLabel(lc.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable")
      .setStyle(lc.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("cfg:levels:setLevelUpChannel")
      .setLabel(lc.levelUpChannel ? "Change Level-Up Channel" : "Set Level-Up Channel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: CE.announce.id, name: CE.announce.name }),
    new ButtonBuilder().setCustomId("cfg:levels:setXpRates")
      .setLabel("XP Rates & Cooldown")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: CE.loading.id, name: CE.loading.name }),
    new ButtonBuilder().setCustomId("cfg:levels:setLevelLimit")
      .setLabel("Level Limit")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: CE.trophy.id, name: CE.trophy.name }),
  );
  const row2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cfg:levels:toggleStackRoles")
      .setLabel(lc.stackRoles ? "Stack Roles: ON" : "Stack Roles: OFF")
      .setStyle(lc.stackRoles ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("cfg:levels:toggleAnnounce")
      .setLabel(lc.levelUpAnnounce ? "Announce: ON" : "Announce: OFF")
      .setStyle(lc.levelUpAnnounce ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("cfg:levels:editMessage")
      .setLabel("Edit Level-Up Message")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: CE.information.id, name: CE.information.name }),
    new ButtonBuilder().setCustomId("cfg:levels:setEmbedColor")
      .setLabel("Embed Color")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: CE.settings.id, name: CE.settings.name }),
  );
  const row3 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cfg:levels:setIgnoredChannels")
      .setLabel("Ignored Channels")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: CE.folder.id, name: CE.folder.name }),
    new ButtonBuilder().setCustomId("cfg:levels:setAllowedChannels")
      .setLabel("Allowed Channels")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: CE.announce.id, name: CE.announce.name }),
    new ButtonBuilder().setCustomId("cfg:levels:setIgnoredRoles")
      .setLabel("Ignored Roles")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: CE.members.id, name: CE.members.name }),
  );
  const row4 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cfg:levels:addLevelRole")
      .setLabel("Add Level Role")
      .setStyle(ButtonStyle.Primary)
      .setEmoji({ id: CE.success.id, name: CE.success.name }),
    new ButtonBuilder().setCustomId("cfg:levels:removeLevelRole")
      .setLabel("Remove Level Role")
      .setStyle(ButtonStyle.Danger)
      .setEmoji({ id: CE.trash.id, name: CE.trash.name })
      .setDisabled(lc.levelRoles.length === 0),
  );
  const row5 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cfg:back").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3, row4, row5];
}

// ── Welcomer UI ───────────────────────────────────────────────────────────────

function fmtWelcomerMode(mode: "embed" | "image" | "text"): string {
  if (mode === "embed") return "Embed";
  if (mode === "image") return "Image Banner";
  return "Text";
}

function buildWelcomerOverviewEmbed(wc: WelcomerConfig): EmbedBuilder {
  const ch = wc.channel;
  const dm = wc.dm;
  const chStatus = ch.enabled
    ? `${CE.check_yes.str} Enabled · ${fmtWelcomerMode(ch.mode)} · ${ch.channelId ? `<#${ch.channelId}>` : "*no channel*"}`
    : `${CE.check_no.str} Disabled`;
  const dmStatus = dm.enabled
    ? `${CE.check_yes.str} Enabled · ${fmtWelcomerMode(dm.mode as any)}`
    : `${CE.check_no.str} Disabled`;
  return new EmbedBuilder()
    .setTitle(`${CE.members.str} Welcomer`)
    .setColor(wc.enabled ? 0x57f287 : 0xed4245)
    .setDescription(wc.enabled ? `${CE.check_yes.str} **Welcomer is enabled**` : `${CE.check_no.str} **Welcomer is disabled**`)
    .addFields(
      { name: "Channel Welcome", value: chStatus, inline: false },
      { name: "DM Welcome",      value: dmStatus, inline: false },
      { name: "Placeholders",    value: "`{user}` · `{username}` · `{server}` · `{count}` · `{ordinal}`", inline: false },
    );
}

function welcomerOverviewRows(wc: WelcomerConfig): Row[] {
  const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:toggle")
      .setLabel(wc.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable")
      .setStyle(wc.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:channel")
      .setLabel("Channel Welcome")
      .setStyle(ButtonStyle.Primary)
      .setEmoji({ id: CE.announce.id, name: CE.announce.name, animated: CE.announce.animated }),
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:dm")
      .setLabel("DM Welcome")
      .setStyle(ButtonStyle.Primary)
      .setEmoji({ id: CE.members.id, name: CE.members.name, animated: CE.members.animated }),
  );
  return [row1, backRow()];
}

function buildWelcomerChannelEmbed(wc: WelcomerConfig): EmbedBuilder {
  const ch = wc.channel;
  const embed = ch.embed ?? {};
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Status",  value: ch.enabled ? `${CE.check_yes.str} Enabled` : `${CE.check_no.str} Disabled`, inline: true },
    { name: "Channel", value: ch.channelId ? `<#${ch.channelId}>` : "*Not set*", inline: true },
    { name: "Mode",    value: fmtWelcomerMode(ch.mode), inline: true },
  ];
  if (ch.mode === "embed") {
    fields.push(
      { name: "Embed Title",       value: embed.title       ?? "*default*", inline: true },
      { name: "Embed Description", value: embed.description ?? "*default*", inline: false },
      { name: "Color",             value: embed.color ? `#${embed.color.toString(16).padStart(6, "0").toUpperCase()}` : "*default*", inline: true },
      { name: "Footer",            value: embed.footer      ?? "*none*",    inline: true },
      { name: "Image URL",         value: embed.imageUrl    ?? "*none*",    inline: false },
      { name: "Thumbnail",         value: embed.thumbnailUrl ?? "*none*",   inline: false },
    );
  } else if (ch.mode === "image") {
    const bg = ch.imageBackground;
    const bgLabel = typeof bg === "number"
      ? `Preset #${bg}: ${BACKGROUND_PRESETS[bg]?.name ?? "?"}`
      : (typeof bg === "string" && bg ? "Custom URL" : "Preset #0: Deep Space");
    fields.push({ name: "Background", value: bgLabel, inline: true });
  } else {
    fields.push({ name: "Message", value: ch.message ?? "*default*", inline: false });
  }
  return new EmbedBuilder()
    .setTitle(`${CE.announce.str} Channel Welcome`)
    .setColor(ch.enabled ? 0x57f287 : 0xed4245)
    .addFields(fields);
}

function welcomerChannelRows(wc: WelcomerConfig): Row[] {
  const ch = wc.channel;
  const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:channel:toggle")
      .setLabel(ch.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable")
      .setStyle(ch.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:channel:setChannel")
      .setLabel(ch.channelId ? "Change Channel" : "Set Channel")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:channel:test")
      .setLabel("Send Test")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: CE.announce.id, name: CE.announce.name, animated: CE.announce.animated }),
  );
  const row2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:channel:modeEmbed")
      .setLabel("Embed Mode")
      .setStyle(ch.mode === "embed" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:channel:modeImage")
      .setLabel("Image Banner Mode")
      .setStyle(ch.mode === "image" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:channel:modeText")
      .setLabel("Text Mode")
      .setStyle(ch.mode === "text" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  const rows: Row[] = [row1, row2];
  if (ch.mode === "embed") {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("cfg:welcomer:channel:editEmbed")
          .setLabel("Edit Embed Text")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("cfg:welcomer:channel:editEmbedImages")
          .setLabel("Set Images")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  } else if (ch.mode === "image") {
    const bgSel = new StringSelectMenuBuilder()
      .setCustomId("cfg:welcomer:channel:bgResult")
      .setPlaceholder("Select background preset")
      .addOptions([
        ...BACKGROUND_PRESETS.map((p, i) => ({ label: `${i}: ${p.name}`, value: String(i), description: `Gradient preset #${i}` })),
        { label: "Custom Image URL", value: "custom", description: "Enter a URL for your own background image" },
      ]);
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(bgSel));
  } else {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("cfg:welcomer:channel:editText")
          .setLabel("Edit Message Text")
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }
  rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:overview")
      .setLabel("← Back to Welcomer")
      .setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

function buildWelcomerDmEmbed(wc: WelcomerConfig): EmbedBuilder {
  const dm = wc.dm;
  const embed = dm.embed ?? {};
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Status", value: dm.enabled ? `${CE.check_yes.str} Enabled` : `${CE.check_no.str} Disabled`, inline: true },
    { name: "Mode",   value: dm.mode === "embed" ? "Embed" : "Text", inline: true },
    { name: "\u200b", value: "\u200b", inline: true },
  ];
  if (dm.mode === "embed") {
    fields.push(
      { name: "Embed Title",       value: embed.title       ?? "*default*", inline: true },
      { name: "Embed Description", value: embed.description ?? "*default*", inline: false },
      { name: "Footer",            value: embed.footer      ?? "*none*",    inline: true },
      { name: "Image URL",         value: embed.imageUrl    ?? "*none*",    inline: false },
    );
  } else {
    fields.push({ name: "Message", value: dm.message ?? "*default*", inline: false });
  }
  return new EmbedBuilder()
    .setTitle(`${CE.members.str} DM Welcome`)
    .setColor(dm.enabled ? 0x57f287 : 0xed4245)
    .addFields(fields);
}

function welcomerDmRows(wc: WelcomerConfig): Row[] {
  const dm = wc.dm;
  const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:dm:toggle")
      .setLabel(dm.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable")
      .setStyle(dm.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:dm:modeEmbed")
      .setLabel("Embed Mode")
      .setStyle(dm.mode === "embed" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:dm:modeText")
      .setLabel("Text Mode")
      .setStyle(dm.mode === "text" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  const rows: Row[] = [row1];
  if (dm.mode === "embed") {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("cfg:welcomer:dm:editEmbed")
          .setLabel("Edit Embed")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("cfg:welcomer:dm:editEmbedImages")
          .setLabel("Set Images")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  } else {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("cfg:welcomer:dm:editText")
          .setLabel("Edit Message Text")
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }
  rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("cfg:welcomer:overview")
      .setLabel("← Back to Welcomer")
      .setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

function buildAutomodEmbed(am: { enabled: boolean; logChannelId?: string; spam: any; badWords: any; links: any; invites: any; caps: any; mentions: any; duplicates: any; newlines: any; aiAutomod: any }): EmbedBuilder {
  const s = (e: boolean) => e ? CE.check_yes.str : CE.check_no.str;
  return new EmbedBuilder()
    .setTitle(`${CE.automod.str} Automod`)
    .setColor(am.enabled ? 0x57f287 : 0xed4245)
    .setDescription(am.enabled ? `${CE.check_yes.str} **Automod is enabled**` : `${CE.check_no.str} **Automod is disabled**`)
    .addFields(
      { name: "Log Channel", value: am.logChannelId ? `<#${am.logChannelId}>` : "*Not set*", inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Rules", value: [
        `${s(am.spam.enabled)} **Spam** — ${am.spam.threshold} msgs/${am.spam.windowSeconds}s → ${am.spam.action}`,
        `${s(am.badWords.enabled)} **Bad Words** — ${am.badWords.words?.length ?? 0} word(s) → ${am.badWords.action}`,
        `${s(am.links.enabled)} **Links** — ${am.links.whitelist?.length ?? 0} allowed domain(s) → ${am.links.action}`,
        `${s(am.invites.enabled)} **Discord Invites** → ${am.invites.action}`,
        `${s(am.caps.enabled)} **Excessive Caps** — ${am.caps.percent}% of ${am.caps.minLength}+ chars → ${am.caps.action}`,
        `${s(am.mentions.enabled)} **Mass Mentions** — ${am.mentions.threshold}+ → ${am.mentions.action}`,
        `${s(am.duplicates.enabled)} **Duplicate Messages** → ${am.duplicates.action}`,
        `${s(am.newlines.enabled)} **Excessive Newlines** — ${am.newlines.threshold}+ → ${am.newlines.action}`,
        `${s(am.aiAutomod?.enabled ?? false)} **AI Automod** — ${(am.aiAutomod?.categories ?? []).join(", ") || "no categories"} → ${am.aiAutomod?.action ?? "delete"} (≥${am.aiAutomod?.minConfidence ?? 75}% confidence)`,
      ].join("\n"), inline: false },
    )
    .setFooter({ text: "Click a rule button to toggle/configure" });
}

function automodRows(am: { enabled: boolean; logChannelId?: string; spam: any; badWords: any; links: any; invites: any; caps: any; mentions: any; duplicates: any; newlines: any; aiAutomod: any }): Row[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId("cfg:automod:toggle").setLabel(am.enabled ? "Enabled — Click to Disable" : "Disabled — Click to Enable").setStyle(am.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("cfg:automod:setLogChannel").setLabel(am.logChannelId ? "Change Log Channel" : "Set Log Channel").setStyle(ButtonStyle.Secondary).setEmoji({ id: CE.clipboard.id, name: CE.clipboard.name, animated: CE.clipboard.animated }),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId("cfg:automod:rule:spam").setLabel("Spam").setStyle(am.spam.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji({ id: CE.warning.id, name: CE.warning.name, animated: CE.warning.animated }),
      new ButtonBuilder().setCustomId("cfg:automod:rule:badWords").setLabel("Bad Words").setStyle(am.badWords.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji({ id: CE.failure.id, name: CE.failure.name, animated: CE.failure.animated }),
      new ButtonBuilder().setCustomId("cfg:automod:rule:links").setLabel("Links").setStyle(am.links.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji({ id: CE.link.id, name: CE.link.name, animated: CE.link.animated }),
      new ButtonBuilder().setCustomId("cfg:automod:rule:invites").setLabel("Invites").setStyle(am.invites.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji({ id: CE.announce.id, name: CE.announce.name, animated: CE.announce.animated }),
      new ButtonBuilder().setCustomId("cfg:automod:rule:caps").setLabel("Caps").setStyle(am.caps.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji({ id: CE.warning.id, name: CE.warning.name, animated: CE.warning.animated }),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId("cfg:automod:rule:mentions").setLabel("Mentions").setStyle(am.mentions.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji({ id: CE.announce.id, name: CE.announce.name, animated: CE.announce.animated }),
      new ButtonBuilder().setCustomId("cfg:automod:rule:duplicates").setLabel("Duplicates").setStyle(am.duplicates.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji({ id: CE.loading.id, name: CE.loading.name, animated: CE.loading.animated }),
      new ButtonBuilder().setCustomId("cfg:automod:rule:newlines").setLabel("Newlines").setStyle(am.newlines.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji({ id: CE.link.id, name: CE.link.name, animated: CE.link.animated }),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId("cfg:automod:rule:aiAutomod").setLabel("AI Automod").setStyle((am.aiAutomod?.enabled ?? false) ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji({ id: CE.admin.id, name: CE.admin.name, animated: CE.admin.animated }),
    ),
    backRow(),
  ];
}

// ── Command definition ────────────────────────────────────────────────────────

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Open the bot configuration menu for this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),


  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: "Run this in a server.", flags: 1 << 6 });
      return;
    }
    if (!isAdminOrOwner(interaction) && !PERM_WHITELIST.has(interaction.user.id)) {
      await interaction.reply({ content: "Only administrators can change the config.", flags: 1 << 6 });
      return;
    }

    const guildId = interaction.guildId;
    await interaction.deferReply();
    let cfg = await getGuildConfig(guildId);

    const reply = await interaction.editReply({
      embeds: [buildOverviewEmbed(cfg)],
      components: [mainDropdownRow(), closeRow()],
    });

    async function safeUpdate(interaction: any, payload: any): Promise<void> {
      try {
        await interaction.update(payload);
      } catch (err: unknown) {
        logger.warn({ err, customId: interaction.customId }, "Fallback update failed, editing original message");
        try {
          if (interaction.message?.edit) {
            await interaction.message.edit(payload).catch(() => {});
          } else if (typeof interaction.editReply === 'function') {
            await interaction.editReply(payload).catch(() => {});
          }
        } catch {
          // ignore
        }
      }
    }

    async function safeSubmitUpdate(interaction: any, payload: any): Promise<void> {
      try {
        await interaction.update(payload);
      } catch (err: unknown) {
        logger.warn({ err, customId: interaction.customId }, "Fallback submit update failed, replying instead");
        try {
          await interaction.reply(payload).catch(() => {});
        } catch {
          // ignore
        }
      }
    }


    const collector = reply.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      idle: 5 * 60 * 1000,
      time: 15 * 60 * 1000,
    });

    collector.on("collect", async (i) => {
      try {
        const id = i.customId;

        // ── Navigation ──────────────────────────────────────────────────────

        if (id === "cfg:close") {
          collector.stop("closed");
          await safeUpdate(i, { content: "Configuration closed.", embeds: [], components: [] });
          return;
        }

        if (id === "cfg:back") {
          cfg = await getGuildConfig(guildId);
          await safeUpdate(i, { embeds: [buildOverviewEmbed(cfg)], components: [mainDropdownRow(), closeRow()] });
          return;
        }

        if (id === "cfg:module:select" && i.isStringSelectMenu()) {
          const modId = i.values[0]!;
          cfg = await getGuildConfig(guildId);

          if (modId === "staff") {
            const view = await staffRolesView(guildId);
            await safeUpdate(i, { embeds: [view.embed], components: view.rows });
            return;
          }
          if (modId === "quota") {
            await safeUpdate(i, { embeds: [buildQuotaEmbed(cfg)], components: quotaRows(cfg) });
            return;
          }
          if (modId === "prefix") {
            await safeUpdate(i, { embeds: [buildPrefixEmbed(cfg)], components: prefixRows(cfg) });
            return;
          }
          if (modId === "botProfile") {
            const me = i.guild?.members.me;
            await safeUpdate(i, {
              embeds: [buildBotProfileEmbed(me?.nickname ?? null, me?.displayAvatarURL() ?? "")],
              components: botProfileRows(),
            });
            return;
          }
          if (modId === "antiNuke") {
            const botMember = i.guild?.members.me;
            const member = await i.guild?.members.fetch(i.user.id).catch(() => null);
            const hasAccess =
              PERM_WHITELIST.has(i.user.id) ||
              (cfg.antiNukeConfig?.accessUserIds?.includes(i.user.id) ?? false) ||
              (botMember && member && member.roles.highest.position > botMember.roles.highest.position);
            if (!hasAccess) {
              await i.reply({ content: `${CE.error.str} You need a role above the bot, global whitelist, or Anti-Nuke access to configure this module.`, flags: 1 << 6 });
              return;
            }
            await i.update({ embeds: [buildAntiNukeOverviewEmbed(cfg)], components: antiNukeOverviewRows(cfg) });
            return;
          }
          if (modId === "shop") {
            const ss = await getShopSettings(guildId);
            await safeUpdate(i, { embeds: [buildShopOverviewEmbed(ss)], components: shopOverviewRows(ss) });
            return;
          }
          if (modId === "tickets") {
            const tc = await getTicketsConfig(guildId);
            await safeUpdate(i, { embeds: [buildTicketsOverviewEmbed(tc)], components: ticketsOverviewRows(tc) });
            return;
          }
          if (modId === "automod") {
            const am = await getAutomodConfig(guildId);
            await safeUpdate(i, { embeds: [buildAutomodEmbed(am)], components: automodRows(am) });
            return;
          }
          if (modId === "levels") {
            const lc = await getLevelConfig(guildId);
            await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
            return;
          }
          if (modId === "welcomer") {
            const wc = await getWelcomerConfig(guildId);
            await safeUpdate(i, { embeds: [buildWelcomerOverviewEmbed(wc)], components: welcomerOverviewRows(wc) });
            return;
          }
          const mod = MODULE_DEFS.find((m) => m.id === modId);
          if (!mod) return;
          await safeUpdate(i, { embeds: [buildModuleEmbed(cfg, mod)], components: moduleActionRows(cfg, mod) });
          return;
        }

        if (id.startsWith("cfg:mod:view:")) {
          const modId = id.slice("cfg:mod:view:".length);
          cfg = await getGuildConfig(guildId);

          if (modId === "staff") {
            const view = await staffRolesView(guildId);
            await safeUpdate(i, { embeds: [view.embed], components: view.rows });
            return;
          }
          if (modId === "quota") {
            await safeUpdate(i, { embeds: [buildQuotaEmbed(cfg)], components: quotaRows(cfg) });
            return;
          }
          if (modId === "prefix") {
            await safeUpdate(i, { embeds: [buildPrefixEmbed(cfg)], components: prefixRows(cfg) });
            return;
          }
          if (modId === "botProfile") {
            const me = i.guild?.members.me;
            await safeUpdate(i, {
              embeds: [buildBotProfileEmbed(me?.nickname ?? null, me?.displayAvatarURL() ?? "")],
              components: botProfileRows(),
            });
            return;
          }
          const mod = MODULE_DEFS.find((m) => m.id === modId);
          if (!mod) return;
          await safeUpdate(i, { embeds: [buildModuleEmbed(cfg, mod)], components: moduleActionRows(cfg, mod) });
          return;
        }


        // ── Tickets handlers ─────────────────────────────────────────────────

        if (id === "cfg:tickets:overview") {
          const tc = await getTicketsConfig(guildId);
          await safeUpdate(i, { embeds: [buildTicketsOverviewEmbed(tc)], components: ticketsOverviewRows(tc) });
          return;
        }
        if (id === "cfg:tickets:toggle") {
          const tc = await updateTicketsConfig(guildId, (c) => ({ ...c, enabled: !c.enabled }));
          await safeUpdate(i, { embeds: [buildTicketsOverviewEmbed(tc)], components: ticketsOverviewRows(tc) });
          return;
        }
        if (id === "cfg:tickets:setSupportRole") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Set Support Role").setDescription("Select the global support staff role — pinged when a ticket is opened.").setColor(0x5865f2)],
            components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId("cfg:tickets:supportRoleResult").setPlaceholder("Select support role")), backRow()],
          });
          return;
        }
        if (id === "cfg:tickets:supportRoleResult" && i.isRoleSelectMenu()) {
          const tc = await updateTicketsConfig(guildId, (c) => ({ ...c, supportRoleId: i.values[0] }));
          await safeUpdate(i, { embeds: [buildTicketsOverviewEmbed(tc)], components: ticketsOverviewRows(tc) });
          return;
        }
        if (id === "cfg:tickets:setAdminRole") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Set Admin Role").setDescription("Select the ticket admin role — can close any ticket.").setColor(0x5865f2)],
            components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId("cfg:tickets:adminRoleResult").setPlaceholder("Select admin role")), backRow()],
          });
          return;
        }
        if (id === "cfg:tickets:adminRoleResult" && i.isRoleSelectMenu()) {
          const tc = await updateTicketsConfig(guildId, (c) => ({ ...c, adminRoleId: i.values[0] }));
          await safeUpdate(i, { embeds: [buildTicketsOverviewEmbed(tc)], components: ticketsOverviewRows(tc) });
          return;
        }
        if (id === "cfg:tickets:setLogChannel") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Set Log Channel").setDescription("Select a channel for ticket logs.").setColor(0x5865f2)],
            components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId("cfg:tickets:logChResult").setChannelTypes(ChannelType.GuildText).setPlaceholder("Select log channel")), backRow()],
          });
          return;
        }
        if (id === "cfg:tickets:logChResult" && i.isChannelSelectMenu()) {
          const tc = await updateTicketsConfig(guildId, (c) => ({ ...c, logChannelId: i.values[0] }));
          await safeUpdate(i, { embeds: [buildTicketsOverviewEmbed(tc)], components: ticketsOverviewRows(tc) });
          return;
        }
        if (id === "cfg:tickets:setTranscriptChannel") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Set Transcript Channel").setDescription("Select where ticket transcripts are sent when tickets close.").setColor(0x5865f2)],
            components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId("cfg:tickets:transcriptChResult").setChannelTypes(ChannelType.GuildText).setPlaceholder("Select channel")), backRow()],
          });
          return;
        }
        if (id === "cfg:tickets:transcriptChResult" && i.isChannelSelectMenu()) {
          const tc = await updateTicketsConfig(guildId, (c) => ({ ...c, transcriptChannelId: i.values[0] }));
          await safeUpdate(i, { embeds: [buildTicketsOverviewEmbed(tc)], components: ticketsOverviewRows(tc) });
          return;
        }
        if (id === "cfg:tickets:addPanel") {
          const modal = new ModalBuilder().setCustomId("cfg:tickets:addPanelModal").setTitle("Create Ticket Panel").addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("panelName").setLabel("Panel Name (used in ticket IDs)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setPlaceholder("e.g. support")),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("embedTitle").setLabel("Embed Title").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setPlaceholder("Support Tickets")),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("embedDescription").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000).setPlaceholder("Click the button below to open a ticket.")),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("buttonLabel").setLabel("Button Label").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder("Open Ticket")),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("buttonEmoji").setLabel("Button Emoji (<:name:id> format)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setPlaceholder(CE.ticket.str)),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ filter: (s) => s.customId === "cfg:tickets:addPanelModal" && s.user.id === i.user.id, time: 5 * 60 * 1000 });
            const panelId = `panel_${Date.now()}`;
            const panel: TicketPanel = {
              id: panelId,
              name: submit.fields.getTextInputValue("panelName").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
              embedTitle: submit.fields.getTextInputValue("embedTitle"),
              embedDescription: submit.fields.getTextInputValue("embedDescription") || "Click the button below to open a ticket.",
              embedColor: 0x5865f2,
              buttonLabel: submit.fields.getTextInputValue("buttonLabel"),
              buttonEmoji: submit.fields.getTextInputValue("buttonEmoji") || undefined,
            };
            await updateTicketsConfig(guildId, (c) => ({ ...c, panels: { ...c.panels, [panelId]: panel } }));
            if (submit.isFromMessage()) {
              await safeSubmitUpdate(submit, { embeds: [buildTicketPanelEmbed(panel)], components: ticketPanelRows(panel) });
            } else {
              await submit.reply({ content: `Panel **${panel.name}** created!`, flags: 1 << 6 });
            }
          } catch { /* dismissed */ }
          return;
        }
        if (id === "cfg:tickets:panelSelect" && i.isStringSelectMenu()) {
          const panelId = i.values[0]!;
          const tc = await getTicketsConfig(guildId);
          const panel = tc.panels[panelId];
          if (!panel) return;
          await safeUpdate(i, { embeds: [buildTicketPanelEmbed(panel)], components: ticketPanelRows(panel) });
          return;
        }
        if (id.startsWith("cfg:tickets:panel:editEmbed:")) {
          const panelId = id.slice("cfg:tickets:panel:editEmbed:".length);
          const tc = await getTicketsConfig(guildId);
          const panel = tc.panels[panelId];
          if (!panel) return;
          const modal = new ModalBuilder().setCustomId(`cfg:tickets:panel:editModal:${panelId}`).setTitle("Edit Panel").addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("embedTitle").setLabel("Embed Title").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(panel.embedTitle)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("embedDescription").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000).setValue(panel.embedDescription || "")),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("buttonLabel").setLabel("Button Label").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(panel.buttonLabel)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("buttonEmoji").setLabel("Button Emoji").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(panel.buttonEmoji || "")),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ filter: (s) => s.customId === `cfg:tickets:panel:editModal:${panelId}` && s.user.id === i.user.id, time: 5 * 60 * 1000 });
            const updated: TicketPanel = { ...panel, embedTitle: submit.fields.getTextInputValue("embedTitle"), embedDescription: submit.fields.getTextInputValue("embedDescription") || "", buttonLabel: submit.fields.getTextInputValue("buttonLabel"), buttonEmoji: submit.fields.getTextInputValue("buttonEmoji") || undefined };
            await updateTicketsConfig(guildId, (c) => ({ ...c, panels: { ...c.panels, [panelId]: updated } }));
            if (submit.isFromMessage()) { await safeSubmitUpdate(submit, { embeds: [buildTicketPanelEmbed(updated)], components: ticketPanelRows(updated) }); }
            else { await submit.reply({ content: "Panel updated!", flags: 1 << 6 }); }
          } catch { /* dismissed */ }
          return;
        }
        if (id.startsWith("cfg:tickets:panel:setSupportRole:")) {
          const panelId = id.slice("cfg:tickets:panel:setSupportRole:".length);
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Override Support Role").setDescription("Select a role to override the global support staff role for this panel only.").setColor(0x5865f2)],
            components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`cfg:tickets:panel:supportRoleRes:${panelId}`).setPlaceholder("Select role")), new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId(`cfg:tickets:panel:view:${panelId}`).setLabel("← Back").setStyle(ButtonStyle.Secondary))],
          });
          return;
        }
        if (id.startsWith("cfg:tickets:panel:supportRoleRes:") && i.isRoleSelectMenu()) {
          const panelId = id.slice("cfg:tickets:panel:supportRoleRes:".length);
          const tc = await updateTicketsConfig(guildId, (c) => { if (!c.panels[panelId]) return c; return { ...c, panels: { ...c.panels, [panelId]: { ...c.panels[panelId]!, supportRoleId: i.values[0] } } }; });
          const panel = tc.panels[panelId]; if (!panel) return;
          await safeUpdate(i, { embeds: [buildTicketPanelEmbed(panel)], components: ticketPanelRows(panel) });
          return;
        }
        if (id.startsWith("cfg:tickets:panel:setCategory:")) {
          const panelId = id.slice("cfg:tickets:panel:setCategory:".length);
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Set Ticket Category").setDescription("Select the category where ticket channels will be created.").setColor(0x5865f2)],
            components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`cfg:tickets:panel:categoryRes:${panelId}`).setChannelTypes(ChannelType.GuildCategory).setPlaceholder("Select category")), new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId(`cfg:tickets:panel:view:${panelId}`).setLabel("← Back").setStyle(ButtonStyle.Secondary))],
          });
          return;
        }
        if (id.startsWith("cfg:tickets:panel:categoryRes:") && i.isChannelSelectMenu()) {
          const panelId = id.slice("cfg:tickets:panel:categoryRes:".length);
          const tc = await updateTicketsConfig(guildId, (c) => { if (!c.panels[panelId]) return c; return { ...c, panels: { ...c.panels, [panelId]: { ...c.panels[panelId]!, categoryId: i.values[0] } } }; });
          const panel = tc.panels[panelId]; if (!panel) return;
          await safeUpdate(i, { embeds: [buildTicketPanelEmbed(panel)], components: ticketPanelRows(panel) });
          return;
        }
        if (id.startsWith("cfg:tickets:panel:setChannel:")) {
          const panelId = id.slice("cfg:tickets:panel:setChannel:".length);
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Set Panel Channel").setDescription("Select where the ticket panel embed will be posted.").setColor(0x5865f2)],
            components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`cfg:tickets:panel:channelRes:${panelId}`).setChannelTypes(ChannelType.GuildText).setPlaceholder("Select channel")), new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId(`cfg:tickets:panel:view:${panelId}`).setLabel("← Back").setStyle(ButtonStyle.Secondary))],
          });
          return;
        }
        if (id.startsWith("cfg:tickets:panel:channelRes:") && i.isChannelSelectMenu()) {
          const panelId = id.slice("cfg:tickets:panel:channelRes:".length);
          const tc = await updateTicketsConfig(guildId, (c) => { if (!c.panels[panelId]) return c; return { ...c, panels: { ...c.panels, [panelId]: { ...c.panels[panelId]!, panelChannelId: i.values[0] } } }; });
          const panel = tc.panels[panelId]; if (!panel) return;
          await safeUpdate(i, { embeds: [buildTicketPanelEmbed(panel)], components: ticketPanelRows(panel) });
          return;
        }
        if (id.startsWith("cfg:tickets:panel:view:")) {
          const panelId = id.slice("cfg:tickets:panel:view:".length);
          const tc = await getTicketsConfig(guildId);
          const panel = tc.panels[panelId]; if (!panel) return;
          await safeUpdate(i, { embeds: [buildTicketPanelEmbed(panel)], components: ticketPanelRows(panel) });
          return;
        }
        if (id.startsWith("cfg:tickets:panel:post:")) {
          const panelId = id.slice("cfg:tickets:panel:post:".length);
          const tc = await getTicketsConfig(guildId);
          const panel = tc.panels[panelId];
          if (!panel) { await i.reply({ content: "Panel not found.", flags: 1 << 6 }); return; }
          if (!panel.panelChannelId) { await i.reply({ content: "Set a panel channel first.", flags: 1 << 6 }); return; }
          const ch = i.guild?.channels.cache.get(panel.panelChannelId) as any;
          if (!ch || !ch.send) { await i.reply({ content: "Channel not found.", flags: 1 << 6 }); return; }
          if (panel.panelMessageId) { await ch.messages.fetch(panel.panelMessageId).then((m: any) => m.delete()).catch(() => {}); }
          const panelEmbed = new EmbedBuilder().setTitle(panel.embedTitle).setDescription(panel.embedDescription || null).setColor(panel.embedColor || 0x5865f2);
          const btnB = new ButtonBuilder().setCustomId(`ticket:open:${panelId}:${guildId}`).setLabel(panel.buttonLabel).setStyle(ButtonStyle.Primary);
          if (panel.buttonEmoji) {
            const cm = panel.buttonEmoji.match(/^<a?:(\w+):(\d+)>$/);
            if (cm) { btnB.setEmoji({ name: cm[1], id: cm[2] }); } else { btnB.setEmoji(panel.buttonEmoji); }
          }
          const msg = await ch.send({ embeds: [panelEmbed], components: [new ActionRowBuilder().addComponents(btnB)] }).catch(() => null);
          if (!msg) { await i.reply({ content: "Failed to post. Check my permissions.", flags: 1 << 6 }); return; }
          const updatedTc = await updateTicketsConfig(guildId, (c) => ({ ...c, panels: { ...c.panels, [panelId]: { ...c.panels[panelId]!, panelMessageId: msg.id } } }));
          const updatedPanel = updatedTc.panels[panelId]!;
          await safeUpdate(i, { embeds: [buildTicketPanelEmbed(updatedPanel)], components: ticketPanelRows(updatedPanel) });
          return;
        }
        if (id.startsWith("cfg:tickets:panel:delete:")) {
          const panelId = id.slice("cfg:tickets:panel:delete:".length);
          const tc = await updateTicketsConfig(guildId, (c) => { const panels = { ...c.panels }; delete panels[panelId]; return { ...c, panels }; });
          await safeUpdate(i, { embeds: [buildTicketsOverviewEmbed(tc)], components: ticketsOverviewRows(tc) });
          return;
        }

        // ── Multi-panel management ────────────────────────────────────────────
        if (id === "cfg:tickets:multiPanel") {
          const tc = await getTicketsConfig(guildId);
          await safeUpdate(i, { embeds: [buildMultiPanelEmbed(tc)], components: multiPanelRows(tc) });
          return;
        }

        if (id === "cfg:tickets:multiPanel:create") {
          const modal = new ModalBuilder().setCustomId("cfg:tickets:multiPanel:createModal").setTitle("Create Multi-Panel").addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("embedTitle").setLabel("Embed Title").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setPlaceholder("Open a Ticket"),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("embedDescription").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000).setPlaceholder("Choose a category below to open a support ticket."),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("useButtons").setLabel('Display style: "buttons" or "dropdown"').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8).setPlaceholder("buttons").setValue("buttons"),
            ),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ filter: (s) => s.customId === "cfg:tickets:multiPanel:createModal" && s.user.id === i.user.id, time: 5 * 60 * 1000 });
            const rawStyle = submit.fields.getTextInputValue("useButtons").trim().toLowerCase();
            const newMp: import("../storage/tickets").MultiPanelConfig = {
              panelIds: [],
              embedTitle: submit.fields.getTextInputValue("embedTitle"),
              embedDescription: submit.fields.getTextInputValue("embedDescription"),
              useButtons: rawStyle !== "dropdown",
            };
            const updatedTc = await updateTicketsConfig(guildId, (c) => ({ ...c, multiPanel: newMp }));
            if (submit.isFromMessage()) {
              await safeSubmitUpdate(submit, { embeds: [buildMultiPanelEmbed(updatedTc)], components: multiPanelRows(updatedTc) });
            } else {
              await submit.reply({ content: "Multi-panel created! Now select panels to include.", flags: 1 << 6 });
            }
          } catch { /* dismissed */ }
          return;
        }

        if (id === "cfg:tickets:multiPanel:editEmbed") {
          const tc = await getTicketsConfig(guildId);
          const mp = tc.multiPanel; if (!mp) return;
          const modal = new ModalBuilder().setCustomId("cfg:tickets:multiPanel:editModal").setTitle("Edit Multi-Panel Embed").addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("embedTitle").setLabel("Embed Title").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(mp.embedTitle),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("embedDescription").setLabel("Embed Description").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000).setValue(mp.embedDescription || ""),
            ),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ filter: (s) => s.customId === "cfg:tickets:multiPanel:editModal" && s.user.id === i.user.id, time: 5 * 60 * 1000 });
            const updatedTc = await updateTicketsConfig(guildId, (c) => ({
              ...c,
              multiPanel: c.multiPanel ? { ...c.multiPanel, embedTitle: submit.fields.getTextInputValue("embedTitle"), embedDescription: submit.fields.getTextInputValue("embedDescription") } : c.multiPanel,
            }));
            if (submit.isFromMessage()) { await safeSubmitUpdate(submit, { embeds: [buildMultiPanelEmbed(updatedTc)], components: multiPanelRows(updatedTc) }); }
            else { await submit.reply({ content: "Embed updated!", flags: 1 << 6 }); }
          } catch { /* dismissed */ }
          return;
        }

        if (id === "cfg:tickets:multiPanel:toggleStyle") {
          const tc = await updateTicketsConfig(guildId, (c) => ({
            ...c, multiPanel: c.multiPanel ? { ...c.multiPanel, useButtons: !c.multiPanel.useButtons } : c.multiPanel,
          }));
          await safeUpdate(i, { embeds: [buildMultiPanelEmbed(tc)], components: multiPanelRows(tc) });
          return;
        }

        if (id === "cfg:tickets:multiPanel:setPanelsRes" && i.isStringSelectMenu()) {
          const tc = await updateTicketsConfig(guildId, (c) => ({
            ...c, multiPanel: c.multiPanel ? { ...c.multiPanel, panelIds: i.values } : c.multiPanel,
          }));
          await safeUpdate(i, { embeds: [buildMultiPanelEmbed(tc)], components: multiPanelRows(tc) });
          return;
        }

        if (id === "cfg:tickets:multiPanel:setChannel") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Set Multi-Panel Channel").setDescription("Select which channel the multi-panel embed will be posted in.").setColor(0x5865f2)],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId("cfg:tickets:multiPanel:channelRes").setChannelTypes(ChannelType.GuildText).setPlaceholder("Select channel")),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ButtonBuilder().setCustomId("cfg:tickets:multiPanel").setLabel("← Back").setStyle(ButtonStyle.Secondary)),
            ],
          });
          return;
        }

        if (id === "cfg:tickets:multiPanel:channelRes" && i.isChannelSelectMenu()) {
          const tc = await updateTicketsConfig(guildId, (c) => ({
            ...c, multiPanel: c.multiPanel ? { ...c.multiPanel, channelId: i.values[0] } : c.multiPanel,
          }));
          await safeUpdate(i, { embeds: [buildMultiPanelEmbed(tc)], components: multiPanelRows(tc) });
          return;
        }

        if (id === "cfg:tickets:multiPanel:post") {
          const tc = await getTicketsConfig(guildId);
          const mp = tc.multiPanel;
          if (!mp) { await i.reply({ content: "No multi-panel configured.", flags: 1 << 6 }); return; }
          if (mp.panelIds.length === 0) { await i.reply({ content: "Add at least one panel to the multi-panel first.", flags: 1 << 6 }); return; }
          if (!mp.channelId) { await i.reply({ content: "Set a channel first.", flags: 1 << 6 }); return; }
          if (!i.guild) { await i.reply({ content: "Guild not found.", flags: 1 << 6 }); return; }
          const postCh = i.guild.channels.cache.get(mp.channelId) as any;
          if (!postCh?.send) { await i.reply({ content: "Channel not found or not accessible.", flags: 1 << 6 }); return; }

          // Delete old message if re-posting
          if (mp.messageId) {
            await postCh.messages.fetch(mp.messageId).then((m: any) => m.delete()).catch(() => {});
          }

          const panelEmbed = new EmbedBuilder().setTitle(mp.embedTitle).setDescription(mp.embedDescription || null).setColor(0x5865f2);
          const includedPanels = mp.panelIds.map((pid) => tc.panels[pid]).filter(Boolean) as TicketPanel[];

          let msgComponents: any[];
          if (mp.useButtons) {
            const btnRows: any[] = [];
            for (let b = 0; b < includedPanels.length; b += 5) {
              const chunk = includedPanels.slice(b, b + 5);
              btnRows.push(new ActionRowBuilder().addComponents(
                chunk.map((p) => {
                  const btn = new ButtonBuilder()
                    .setCustomId(`ticket:open:${p.id}:${guildId}`)
                    .setLabel(p.buttonLabel)
                    .setStyle(ButtonStyle.Primary);
                  if (p.buttonEmoji) {
                    const cm = p.buttonEmoji.match(/^<a?:(\w+):(\d+)>$/);
                    if (cm) btn.setEmoji({ name: cm[1]!, id: cm[2]! }); else btn.setEmoji(p.buttonEmoji);
                  }
                  return btn;
                }),
              ));
            }
            msgComponents = btnRows;
          } else {
            const select = new StringSelectMenuBuilder()
              .setCustomId(`ticket:multipanel:select:${guildId}`)
              .setPlaceholder("Choose a ticket category…")
              .addOptions(
                includedPanels.map((p) => ({
                  label: p.buttonLabel.slice(0, 25),
                  value: p.id,
                  description: p.name.slice(0, 50),
                })),
              );
            msgComponents = [new ActionRowBuilder().addComponents(select)];
          }

          const msg = await postCh.send({ embeds: [panelEmbed], components: msgComponents }).catch(() => null);
          if (!msg) { await i.reply({ content: "Failed to post. Check my permissions.", flags: 1 << 6 }); return; }

          const updatedTc = await updateTicketsConfig(guildId, (c) => ({
            ...c, multiPanel: c.multiPanel ? { ...c.multiPanel, messageId: msg.id } : c.multiPanel,
          }));
          await safeUpdate(i, { embeds: [buildMultiPanelEmbed(updatedTc)], components: multiPanelRows(updatedTc) });
          return;
        }

        if (id === "cfg:tickets:multiPanel:delete") {
          const tc = await updateTicketsConfig(guildId, (c) => ({ ...c, multiPanel: undefined }));
          await safeUpdate(i, { embeds: [buildTicketsOverviewEmbed(tc)], components: ticketsOverviewRows(tc) });
          return;
        }

        // ── Ticket questions management ───────────────────────────────────────
        if (id.startsWith("cfg:tickets:panel:questions:")) {
          const panelId = id.slice("cfg:tickets:panel:questions:".length);
          const tc = await getTicketsConfig(guildId);
          const panel = tc.panels[panelId]; if (!panel) return;
          await safeUpdate(i, { embeds: [buildPanelQuestionsEmbed(panel)], components: panelQuestionsRows(panel) });
          return;
        }

        if (id.startsWith("cfg:tickets:panel:addQuestion:")) {
          const panelId = id.slice("cfg:tickets:panel:addQuestion:".length);
          const tc = await getTicketsConfig(guildId);
          const panel = tc.panels[panelId]; if (!panel) return;
          if ((panel.questions?.length ?? 0) >= 5) {
            await i.reply({ content: "Maximum of 5 questions allowed per panel.", flags: 1 << 6 }); return;
          }
          const modal = new ModalBuilder().setCustomId(`cfg:tickets:panel:addQuestionModal:${panelId}`).setTitle("Add Pre-Ticket Question").addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("label").setLabel("Question (shown to user, max 45 chars)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(45).setPlaceholder("e.g. What is your issue?"),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("style").setLabel('Answer style: "short" or "paragraph"').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setPlaceholder("short").setValue("short"),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("required").setLabel('Required? "yes" or "no"').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setPlaceholder("yes").setValue("yes"),
            ),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ filter: (s) => s.customId === `cfg:tickets:panel:addQuestionModal:${panelId}` && s.user.id === i.user.id, time: 5 * 60 * 1000 });
            const label = submit.fields.getTextInputValue("label").trim();
            const rawStyle = submit.fields.getTextInputValue("style").trim().toLowerCase();
            const rawRequired = submit.fields.getTextInputValue("required").trim().toLowerCase();
            const style: TicketQuestion["style"] = rawStyle === "paragraph" ? "paragraph" : "short";
            const required = rawRequired !== "no";
            const newQuestion: TicketQuestion = { label, style, required };
            const updatedTc = await updateTicketsConfig(guildId, (c) => {
              const p = c.panels[panelId]; if (!p) return c;
              return { ...c, panels: { ...c.panels, [panelId]: { ...p, questions: [...(p.questions ?? []), newQuestion] } } };
            });
            const updatedPanel = updatedTc.panels[panelId]!;
            if (submit.isFromMessage()) {
              await safeSubmitUpdate(submit, { embeds: [buildPanelQuestionsEmbed(updatedPanel)], components: panelQuestionsRows(updatedPanel) });
            } else {
              await submit.reply({ content: "Question added!", flags: 1 << 6 });
            }
          } catch { /* dismissed */ }
          return;
        }

        if (id.startsWith("cfg:tickets:panel:removeQuestion:")) {
          const rest = id.slice("cfg:tickets:panel:removeQuestion:".length);
          const lastColon = rest.lastIndexOf(":");
          const panelId = rest.slice(0, lastColon);
          const idx = parseInt(rest.slice(lastColon + 1), 10);
          const updatedTc = await updateTicketsConfig(guildId, (c) => {
            const p = c.panels[panelId]; if (!p) return c;
            const qs = [...(p.questions ?? [])];
            qs.splice(idx, 1);
            return { ...c, panels: { ...c.panels, [panelId]: { ...p, questions: qs } } };
          });
          const updatedPanel = updatedTc.panels[panelId];
          if (!updatedPanel) return;
          await safeUpdate(i, { embeds: [buildPanelQuestionsEmbed(updatedPanel)], components: panelQuestionsRows(updatedPanel) });
          return;
        }

        // ── Welcomer handlers ────────────────────────────────────────────────

        if (id === "cfg:welcomer:overview") {
          const wc = await getWelcomerConfig(guildId);
          await safeUpdate(i, { embeds: [buildWelcomerOverviewEmbed(wc)], components: welcomerOverviewRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:toggle") {
          const wc = await updateWelcomerConfig(guildId, (c) => { c.enabled = !c.enabled; });
          await safeUpdate(i, { embeds: [buildWelcomerOverviewEmbed(wc)], components: welcomerOverviewRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:channel") {
          const wc = await getWelcomerConfig(guildId);
          await safeUpdate(i, { embeds: [buildWelcomerChannelEmbed(wc)], components: welcomerChannelRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:channel:toggle") {
          const wc = await updateWelcomerConfig(guildId, (c) => { c.channel.enabled = !c.channel.enabled; });
          await safeUpdate(i, { embeds: [buildWelcomerChannelEmbed(wc)], components: welcomerChannelRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:channel:setChannel") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Set Welcome Channel").setDescription("Select the channel where welcome messages will be sent.").setColor(0x5865f2)],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("cfg:welcomer:channel:chResult").setChannelTypes(ChannelType.GuildText).setPlaceholder("Select channel"),
              ),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId("cfg:welcomer:channel").setLabel("← Back").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }
        if (id === "cfg:welcomer:channel:chResult" && i.isChannelSelectMenu()) {
          const wc = await updateWelcomerConfig(guildId, (c) => { c.channel.channelId = i.values[0]; });
          await safeUpdate(i, { embeds: [buildWelcomerChannelEmbed(wc)], components: welcomerChannelRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:channel:modeEmbed") {
          const wc = await updateWelcomerConfig(guildId, (c) => { c.channel.mode = "embed"; });
          await safeUpdate(i, { embeds: [buildWelcomerChannelEmbed(wc)], components: welcomerChannelRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:channel:modeImage") {
          const wc = await updateWelcomerConfig(guildId, (c) => { c.channel.mode = "image"; });
          await safeUpdate(i, { embeds: [buildWelcomerChannelEmbed(wc)], components: welcomerChannelRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:channel:modeText") {
          const wc = await updateWelcomerConfig(guildId, (c) => { c.channel.mode = "text"; });
          await safeUpdate(i, { embeds: [buildWelcomerChannelEmbed(wc)], components: welcomerChannelRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:channel:editEmbed") {
          const wc = await getWelcomerConfig(guildId);
          const embed = wc.channel.embed ?? {};
          const modal = new ModalBuilder().setCustomId("cfg:welcomer:channel:embedModal").setTitle("Edit Channel Welcome Embed");
          modal.addComponents(
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Title").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.title ?? "Welcome to {server}!")),
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("description").setLabel("Description (supports placeholders)").setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(embed.description ?? "Hey {user}, welcome! You are member #{count}.")),
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("color").setLabel("Color (hex, e.g. #5865F2)").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.color ? `#${embed.color.toString(16).padStart(6,"0")}` : "#5865F2")),
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("footer").setLabel("Footer text").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.footer ?? "{server} • {count} members")),
          );
          await i.showModal(modal);
          const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:welcomer:channel:embedModal" }).catch(() => null);
          if (!submit) return;
          await submit.deferUpdate();
          const colorHex = submit.fields.getTextInputValue("color").replace("#", "").trim();
          const colorNum = colorHex ? parseInt(colorHex, 16) : undefined;
          const wc2 = await updateWelcomerConfig(guildId, (c) => {
            c.channel.embed = {
              ...c.channel.embed,
              title: submit.fields.getTextInputValue("title") || undefined,
              description: submit.fields.getTextInputValue("description") || undefined,
              color: colorNum && !isNaN(colorNum) ? colorNum : c.channel.embed?.color,
              footer: submit.fields.getTextInputValue("footer") || undefined,
            };
          });
          await safeUpdate(submit, { embeds: [buildWelcomerChannelEmbed(wc2)], components: welcomerChannelRows(wc2) });
          return;
        }
        if (id === "cfg:welcomer:channel:editEmbedImages") {
          const wc = await getWelcomerConfig(guildId);
          const embed = wc.channel.embed ?? {};
          const modal = new ModalBuilder().setCustomId("cfg:welcomer:channel:embedImagesModal").setTitle("Set Embed Images");
          modal.addComponents(
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("imageUrl").setLabel("Image URL (large image at bottom of embed)").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.imageUrl ?? "")),
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("thumbnailUrl").setLabel("Thumbnail URL (small image top-right)").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.thumbnailUrl ?? "")),
          );
          await i.showModal(modal);
          const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:welcomer:channel:embedImagesModal" }).catch(() => null);
          if (!submit) return;
          await submit.deferUpdate();
          const wc2 = await updateWelcomerConfig(guildId, (c) => {
            c.channel.embed = {
              ...c.channel.embed,
              imageUrl: submit.fields.getTextInputValue("imageUrl") || undefined,
              thumbnailUrl: submit.fields.getTextInputValue("thumbnailUrl") || undefined,
            };
          });
          await safeUpdate(submit, { embeds: [buildWelcomerChannelEmbed(wc2)], components: welcomerChannelRows(wc2) });
          return;
        }
        if (id === "cfg:welcomer:channel:bgResult" && i.isStringSelectMenu()) {
          const val = i.values[0];
          if (val === "custom") {
            const modal = new ModalBuilder().setCustomId("cfg:welcomer:channel:customBgModal").setTitle("Custom Background URL");
            modal.addComponents(
              new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("url").setLabel("Background image URL (direct image link)").setStyle(TextInputStyle.Short).setRequired(true)),
            );
            await i.showModal(modal);
            const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:welcomer:channel:customBgModal" }).catch(() => null);
            if (!submit) return;
            await submit.deferUpdate();
            const wc2 = await updateWelcomerConfig(guildId, (c) => { c.channel.imageBackground = submit.fields.getTextInputValue("url").trim(); });
            await safeUpdate(submit, { embeds: [buildWelcomerChannelEmbed(wc2)], components: welcomerChannelRows(wc2) });
          } else {
            const wc2 = await updateWelcomerConfig(guildId, (c) => { c.channel.imageBackground = parseInt(val, 10); });
            await safeUpdate(i, { embeds: [buildWelcomerChannelEmbed(wc2)], components: welcomerChannelRows(wc2) });
          }
          return;
        }
        if (id === "cfg:welcomer:channel:editText") {
          const wc = await getWelcomerConfig(guildId);
          const modal = new ModalBuilder().setCustomId("cfg:welcomer:channel:textModal").setTitle("Edit Welcome Message");
          modal.addComponents(
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message (supports placeholders)").setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(wc.channel.message ?? "Welcome {user} to {server}! You are our {ordinal} member 🎉")),
          );
          await i.showModal(modal);
          const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:welcomer:channel:textModal" }).catch(() => null);
          if (!submit) return;
          await submit.deferUpdate();
          const wc2 = await updateWelcomerConfig(guildId, (c) => { c.channel.message = submit.fields.getTextInputValue("message"); });
          await safeUpdate(submit, { embeds: [buildWelcomerChannelEmbed(wc2)], components: welcomerChannelRows(wc2) });
          return;
        }
        if (id === "cfg:welcomer:channel:test") {
          const wc = await getWelcomerConfig(guildId);
          const ch = wc.channel;
          const targetChannelId = ch.channelId;
          if (!targetChannelId) {
            await i.reply({ content: `${CE.error.str} No welcome channel set. Configure one first.`, flags: 1 << 6 });
            return;
          }
          const targetCh = await i.guild?.channels.fetch(targetChannelId).catch(() => null);
          if (!targetCh || targetCh.type !== ChannelType.GuildText) {
            await i.reply({ content: `${CE.error.str} Channel not found or not a text channel.`, flags: 1 << 6 });
            return;
          }
          const member = i.member as any;
          const user = i.user;
          const guild = i.guild!;
          const count = guild.memberCount;
          await i.deferUpdate();
          try {
            const { applyWelcomerPlaceholders, buildWelcomerEmbed, buildWelcomerText } = await import("../utils/welcomeSender");
            const { generateWelcomeImage } = await import("../utils/welcomeImage");
            if (ch.mode === "embed") {
              const embed = buildWelcomerEmbed(ch.embed ?? {}, user, guild, count);
              if (ch.embed?.showAvatar !== false) embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
              await (targetCh as any).send({ embeds: [embed] });
            } else if (ch.mode === "image") {
              const imgBuf = await generateWelcomeImage({ avatarUrl: user.displayAvatarURL({ extension: "png", size: 256 }), username: user.username, memberCount: count, serverName: guild.name, background: ch.imageBackground });
              const { AttachmentBuilder } = await import("discord.js");
              const att = new AttachmentBuilder(imgBuf, { name: "welcome.png" });
              await (targetCh as any).send({ files: [att] });
            } else {
              const text = applyWelcomerPlaceholders(ch.message ?? "Welcome {user}!", user, guild, count);
              await (targetCh as any).send({ content: text });
            }
            await safeUpdate(i, { embeds: [buildWelcomerChannelEmbed(wc).setFooter({ text: `✅ Test sent to #${(targetCh as any).name}` })], components: welcomerChannelRows(wc) });
          } catch (err) {
            logger.error({ err }, "Welcomer test send failed");
            await safeUpdate(i, { embeds: [buildWelcomerChannelEmbed(wc).setFooter({ text: "❌ Failed to send test. Check bot permissions." })], components: welcomerChannelRows(wc) });
          }
          return;
        }

        // DM welcome handlers
        if (id === "cfg:welcomer:dm") {
          const wc = await getWelcomerConfig(guildId);
          await safeUpdate(i, { embeds: [buildWelcomerDmEmbed(wc)], components: welcomerDmRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:dm:toggle") {
          const wc = await updateWelcomerConfig(guildId, (c) => { c.dm.enabled = !c.dm.enabled; });
          await safeUpdate(i, { embeds: [buildWelcomerDmEmbed(wc)], components: welcomerDmRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:dm:modeEmbed") {
          const wc = await updateWelcomerConfig(guildId, (c) => { c.dm.mode = "embed"; });
          await safeUpdate(i, { embeds: [buildWelcomerDmEmbed(wc)], components: welcomerDmRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:dm:modeText") {
          const wc = await updateWelcomerConfig(guildId, (c) => { c.dm.mode = "text"; });
          await safeUpdate(i, { embeds: [buildWelcomerDmEmbed(wc)], components: welcomerDmRows(wc) });
          return;
        }
        if (id === "cfg:welcomer:dm:editEmbed") {
          const wc = await getWelcomerConfig(guildId);
          const embed = wc.dm.embed ?? {};
          const modal = new ModalBuilder().setCustomId("cfg:welcomer:dm:embedModal").setTitle("Edit DM Welcome Embed");
          modal.addComponents(
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Title").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.title ?? "Welcome to {server}!")),
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("description").setLabel("Description (supports placeholders)").setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(embed.description ?? "We're happy to have you, {username}!")),
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("color").setLabel("Color (hex, e.g. #5865F2)").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.color ? `#${embed.color.toString(16).padStart(6,"0")}` : "#5865F2")),
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("footer").setLabel("Footer text").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.footer ?? "")),
          );
          await i.showModal(modal);
          const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:welcomer:dm:embedModal" }).catch(() => null);
          if (!submit) return;
          await submit.deferUpdate();
          const colorHex = submit.fields.getTextInputValue("color").replace("#", "").trim();
          const colorNum = colorHex ? parseInt(colorHex, 16) : undefined;
          const wc2 = await updateWelcomerConfig(guildId, (c) => {
            c.dm.embed = {
              ...c.dm.embed,
              title: submit.fields.getTextInputValue("title") || undefined,
              description: submit.fields.getTextInputValue("description") || undefined,
              color: colorNum && !isNaN(colorNum) ? colorNum : c.dm.embed?.color,
              footer: submit.fields.getTextInputValue("footer") || undefined,
            };
          });
          await safeUpdate(submit, { embeds: [buildWelcomerDmEmbed(wc2)], components: welcomerDmRows(wc2) });
          return;
        }
        if (id === "cfg:welcomer:dm:editEmbedImages") {
          const wc = await getWelcomerConfig(guildId);
          const embed = wc.dm.embed ?? {};
          const modal = new ModalBuilder().setCustomId("cfg:welcomer:dm:embedImagesModal").setTitle("Set DM Embed Images");
          modal.addComponents(
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("imageUrl").setLabel("Image URL").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.imageUrl ?? "")),
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("thumbnailUrl").setLabel("Thumbnail URL").setStyle(TextInputStyle.Short).setRequired(false).setValue(embed.thumbnailUrl ?? "")),
          );
          await i.showModal(modal);
          const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:welcomer:dm:embedImagesModal" }).catch(() => null);
          if (!submit) return;
          await submit.deferUpdate();
          const wc2 = await updateWelcomerConfig(guildId, (c) => {
            c.dm.embed = {
              ...c.dm.embed,
              imageUrl: submit.fields.getTextInputValue("imageUrl") || undefined,
              thumbnailUrl: submit.fields.getTextInputValue("thumbnailUrl") || undefined,
            };
          });
          await safeUpdate(submit, { embeds: [buildWelcomerDmEmbed(wc2)], components: welcomerDmRows(wc2) });
          return;
        }
        if (id === "cfg:welcomer:dm:editText") {
          const wc = await getWelcomerConfig(guildId);
          const modal = new ModalBuilder().setCustomId("cfg:welcomer:dm:textModal").setTitle("Edit DM Message");
          modal.addComponents(
            new ActionRowBuilder<any>().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message (supports placeholders)").setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(wc.dm.message ?? "Welcome to {server}, {username}! 🎉")),
          );
          await i.showModal(modal);
          const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:welcomer:dm:textModal" }).catch(() => null);
          if (!submit) return;
          await submit.deferUpdate();
          const wc2 = await updateWelcomerConfig(guildId, (c) => { c.dm.message = submit.fields.getTextInputValue("message"); });
          await safeUpdate(submit, { embeds: [buildWelcomerDmEmbed(wc2)], components: welcomerDmRows(wc2) });
          return;
        }

        // ── Automod handlers ─────────────────────────────────────────────────

        if (id === "cfg:automod:overview") {
          const am = await getAutomodConfig(guildId);
          await safeUpdate(i, { embeds: [buildAutomodEmbed(am)], components: automodRows(am) });
          return;
        }
        if (id === "cfg:automod:toggle") {
          const am = await updateAutomodConfig(guildId, (c) => ({ ...c, enabled: !c.enabled }));
          await safeUpdate(i, { embeds: [buildAutomodEmbed(am)], components: automodRows(am) });
          return;
        }
        if (id === "cfg:automod:setLogChannel") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setTitle("Automod Log Channel").setDescription("Select a channel for automod action logs.").setColor(0x5865f2)],
            components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId("cfg:automod:logChRes").setChannelTypes(ChannelType.GuildText).setPlaceholder("Select log channel")), backRow()],
          });
          return;
        }
        if (id === "cfg:automod:logChRes" && i.isChannelSelectMenu()) {
          const am = await updateAutomodConfig(guildId, (c) => ({ ...c, logChannelId: i.values[0] }));
          await safeUpdate(i, { embeds: [buildAutomodEmbed(am)], components: automodRows(am) });
          return;
        }
        if (id === "cfg:automod:rule:aiAutomod") {
          const amNow = await getAutomodConfig(guildId);
          const _aiDef = { enabled: false, action: "delete" as const, muteDurationMinutes: 10, exemptRoleIds: [] as string[], exemptChannelIds: [] as string[], whitelist: [] as string[], categories: ["threat","hate_speech","slur"], minConfidence: 75 };
          const ai = amNow.aiAutomod ?? _aiDef;
          const modal = new ModalBuilder()
            .setCustomId("cfg:automod:ruleModal:aiAutomod")
            .setTitle("AI Automod")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId("enabled").setLabel("Enabled? (yes/no)").setStyle(TextInputStyle.Short).setValue(ai.enabled ? "yes" : "no"),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId("action").setLabel("Action: delete / warn / mute / kick / ban").setStyle(TextInputStyle.Short).setValue(ai.action),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId("confidence").setLabel("Min confidence % (0–100, default 75)").setStyle(TextInputStyle.Short).setValue(String(ai.minConfidence ?? 75)),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId("categories").setLabel("Categories (comma-separated)").setStyle(TextInputStyle.Short).setRequired(false).setValue((ai.categories ?? []).join(",")),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId("whitelist").setLabel("Ignore words (comma-separated)").setStyle(TextInputStyle.Short).setRequired(false).setValue((ai.whitelist ?? []).join(",")),
              ),
            );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ filter: (s) => s.customId === "cfg:automod:ruleModal:aiAutomod" && s.user.id === i.user.id, time: 5 * 60 * 1000 });
            const enRaw = submit.fields.getTextInputValue("enabled").toLowerCase();
            const enabled = enRaw === "yes" || enRaw === "true" || enRaw === "1";
            const actRaw = submit.fields.getTextInputValue("action").trim().toLowerCase();
            const action = (["delete","warn","mute","kick","ban"].includes(actRaw) ? actRaw : "delete") as "delete"|"warn"|"mute"|"kick"|"ban";
            const confidence = Math.min(100, Math.max(0, parseInt(submit.fields.getTextInputValue("confidence"), 10) || 75));
            const catRaw = submit.fields.getTextInputValue("categories").trim();
            const categories = catRaw ? catRaw.split(",").map((s) => s.trim()).filter(Boolean) : ["threat","hate_speech","slur"];
            const wlRaw = submit.fields.getTextInputValue("whitelist").trim();
            const whitelist = wlRaw ? wlRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
            const am = await updateAutomodConfig(guildId, (c) => ({
              ...c,
              aiAutomod: { ...c.aiAutomod, enabled, action, minConfidence: confidence, categories, whitelist },
            }));
            if (submit.isFromMessage()) { await safeSubmitUpdate(submit, { embeds: [buildAutomodEmbed(am)], components: automodRows(am) }); }
            else { await submit.reply({ content: `AI Automod updated.`, flags: 1 << 6 }); }
          } catch { /* dismissed */ }
          return;
        }

        if (id.startsWith("cfg:automod:rule:")) {
          type RuleKey = "spam"|"badWords"|"links"|"invites"|"caps"|"mentions"|"duplicates"|"newlines";
          const ruleKey = id.slice("cfg:automod:rule:".length) as RuleKey;
          const valid: RuleKey[] = ["spam","badWords","links","invites","caps","mentions","duplicates","newlines"];
          if (!valid.includes(ruleKey)) return;
          const amNow = await getAutomodConfig(guildId);
          const rule = (amNow as any)[ruleKey];
          const labels: Record<RuleKey, string> = { spam:"Spam Detection", badWords:"Bad Words", links:"Link Filter", invites:"Discord Invites", caps:"Excessive Caps", mentions:"Mass Mentions", duplicates:"Duplicate Messages", newlines:"Excessive Newlines" };
          const extraDefault = ruleKey==="spam" ? `${rule.threshold}/${rule.windowSeconds}` : ruleKey==="badWords" ? (rule.words||[]).join(",") : ruleKey==="links" ? (rule.whitelist||[]).join(",") : ruleKey==="caps" ? `${rule.percent}/${rule.minLength}` : ruleKey==="mentions" ? String(rule.threshold??5) : ruleKey==="duplicates" ? String(rule.windowSeconds??30) : ruleKey==="newlines" ? String(rule.threshold??10) : "";
          const extraHelp: Record<RuleKey, string> = { spam:"threshold/windowSecs e.g. 5/5", badWords:"comma-separated words", links:"comma-separated allowed domains", invites:"(no extra setting)", caps:"percent/minLength e.g. 70/15", mentions:"threshold e.g. 5", duplicates:"windowSeconds e.g. 30", newlines:"threshold e.g. 10" };
          const modal = new ModalBuilder().setCustomId(`cfg:automod:ruleModal:${ruleKey}`).setTitle(labels[ruleKey]).addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("enabled").setLabel("Enabled? (yes/no)").setStyle(TextInputStyle.Short).setValue(rule.enabled ? "yes" : "no")),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("action").setLabel("Action: delete / warn / mute / kick / ban").setStyle(TextInputStyle.Short).setValue(rule.action)),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("muteDuration").setLabel("Mute duration minutes (if action=mute)").setStyle(TextInputStyle.Short).setValue(String(rule.muteDurationMinutes??10))),
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("extra").setLabel(`Setting: ${extraHelp[ruleKey]}`).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500).setValue(extraDefault)),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ filter: (s) => s.customId === `cfg:automod:ruleModal:${ruleKey}` && s.user.id === i.user.id, time: 5*60*1000 });
            const enRaw = submit.fields.getTextInputValue("enabled").toLowerCase();
            const enabled = enRaw==="yes"||enRaw==="true"||enRaw==="1";
            const actRaw = submit.fields.getTextInputValue("action").trim().toLowerCase();
            const action = ["delete","warn","mute","kick","ban"].includes(actRaw) ? actRaw : "delete";
            const muteDuration = parseInt(submit.fields.getTextInputValue("muteDuration"),10)||10;
            const extra = submit.fields.getTextInputValue("extra").trim();
            const am = await updateAutomodConfig(guildId, (c) => {
              const base = { ...(c as any)[ruleKey], enabled, action, muteDurationMinutes: muteDuration };
              if (ruleKey==="spam") { const [t,w]=extra.split("/").map(Number); if(t&&w){base.threshold=t;base.windowSeconds=w;} }
              else if (ruleKey==="badWords") { base.words=extra?extra.split(",").map((s:string)=>s.trim()).filter(Boolean):[]; }
              else if (ruleKey==="links") { base.whitelist=extra?extra.split(",").map((s:string)=>s.trim()).filter(Boolean):[]; }
              else if (ruleKey==="caps") { const [p,m]=extra.split("/").map(Number); if(p)base.percent=p; if(m)base.minLength=m; }
              else if (ruleKey==="mentions") { const t=parseInt(extra,10); if(t)base.threshold=t; }
              else if (ruleKey==="duplicates") { const w=parseInt(extra,10); if(w)base.windowSeconds=w; }
              else if (ruleKey==="newlines") { const t=parseInt(extra,10); if(t)base.threshold=t; }
              return { ...c, [ruleKey]: base };
            });
            if (submit.isFromMessage()) { await safeSubmitUpdate(submit, { embeds: [buildAutomodEmbed(am)], components: automodRows(am) }); }
            else { await submit.reply({ content: `${labels[ruleKey]} updated.`, flags: 1 << 6 }); }
          } catch { /* dismissed */ }
          return;
        }

        // ── Anti-Nuke handlers ────────────────────────────────────────────────

        if (id === "cfg:an:overview") {
          cfg = await getGuildConfig(guildId);
          await i.update({ embeds: [buildAntiNukeOverviewEmbed(cfg)], components: antiNukeOverviewRows(cfg) });
          return;
        }

        if (id === "cfg:an:toggle") {
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            an.enabled = !an.enabled;
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeOverviewEmbed(cfg)], components: antiNukeOverviewRows(cfg) });
          return;
        }

        if (id === "cfg:an:enableAll") {
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            an.enabled = true;
            const common = an.commonPunishment;
            an.antiJoin.enabled = true;
            an.antiJoin.punishment = common;
            an.antiBan.enabled = true;
            an.antiBan.punishment = common;
            an.antiKick.enabled = true;
            an.antiKick.punishment = common;
            an.antiRole.enabled = true;
            an.antiRole.punishment = common;
            an.antiChannel.enabled = true;
            an.antiChannel.punishment = common;
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeOverviewEmbed(cfg)], components: antiNukeOverviewRows(cfg) });
          return;
        }

        if (id === "cfg:an:disableAll") {
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            an.antiJoin.enabled = false;
            an.antiBan.enabled = false;
            an.antiKick.enabled = false;
            an.antiRole.enabled = false;
            an.antiChannel.enabled = false;
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeOverviewEmbed(cfg)], components: antiNukeOverviewRows(cfg) });
          return;
        }

        if (id === "cfg:an:commonPunish") {
          const commonPunishSel = new StringSelectMenuBuilder()
            .setCustomId("cfg:an:commonPunishSet")
            .setPlaceholder("Select common punishment")
            .addOptions(
              (Object.entries(AN_PUNISHMENT_LABELS) as [AntiNukePunishment, string][]).map(([value, label]) => ({
                label, value,
                default: (cfg.antiNukeConfig?.commonPunishment ?? "none") === value,
              })),
            );
          await i.update({
            embeds: [
              new EmbedBuilder()
                .setTitle(`${CE.warning.str} Anti-Nuke · Common Punishment`)
                .setColor(0x5865f2)
                .setDescription("Select the punishment to use when **Enable All** is applied.\nThis also sets the punishment for all mini-modules when you press Enable All."),
            ],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(commonPunishSel),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId("cfg:an:overview").setLabel("← Anti-Nuke").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }

        if (id === "cfg:an:commonPunishSet" && i.isStringSelectMenu()) {
          const punishment = i.values[0] as AntiNukePunishment;
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            an.commonPunishment = punishment;
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeOverviewEmbed(cfg)], components: antiNukeOverviewRows(cfg) });
          return;
        }

        if (id === "cfg:an:access") {
          cfg = await getGuildConfig(guildId);
          await i.update({ embeds: [buildAntiNukeAccessEmbed(cfg)], components: antiNukeAccessRows(cfg) });
          return;
        }

        if (id === "cfg:an:accessAdd" && i.isUserSelectMenu()) {
          const toAdd = i.values.filter((uid) => !(cfg.antiNukeConfig?.accessUserIds ?? []).includes(uid));
          if (toAdd.length > 0) {
            cfg = await updateGuildConfig(guildId, (c) => {
              const an = getAntiNukeConfig(c);
              an.accessUserIds = [...an.accessUserIds, ...toAdd];
              c.antiNukeConfig = an;
              return c;
            });
          }
          await i.update({ embeds: [buildAntiNukeAccessEmbed(cfg)], components: antiNukeAccessRows(cfg) });
          return;
        }

        if (id === "cfg:an:accessRemove" && i.isStringSelectMenu()) {
          const toRemove = i.values[0]!;
          if (toRemove !== "_noop") {
            cfg = await updateGuildConfig(guildId, (c) => {
              const an = getAntiNukeConfig(c);
              an.accessUserIds = an.accessUserIds.filter((uid) => uid !== toRemove);
              c.antiNukeConfig = an;
              return c;
            });
          }
          await i.update({ embeds: [buildAntiNukeAccessEmbed(cfg)], components: antiNukeAccessRows(cfg) });
          return;
        }

        if (id === "cfg:an:globalWL") {
          cfg = await getGuildConfig(guildId);
          await i.update({ embeds: [buildAntiNukeGlobalWLEmbed(cfg)], components: antiNukeGlobalWLRows() });
          return;
        }

        if (id === "cfg:an:gwlAddUser" && i.isUserSelectMenu()) {
          const toAdd = i.values.filter((uid) => !(cfg.antiNukeConfig?.globalWhitelistUserIds ?? []).includes(uid));
          if (toAdd.length > 0) {
            cfg = await updateGuildConfig(guildId, (c) => {
              const an = getAntiNukeConfig(c);
              an.globalWhitelistUserIds = [...an.globalWhitelistUserIds, ...toAdd];
              c.antiNukeConfig = an;
              return c;
            });
          }
          await i.update({ embeds: [buildAntiNukeGlobalWLEmbed(cfg)], components: antiNukeGlobalWLRows() });
          return;
        }

        if (id === "cfg:an:gwlAddRole" && i.isRoleSelectMenu()) {
          const toAdd = i.values.filter((rid) => !(cfg.antiNukeConfig?.globalWhitelistRoleIds ?? []).includes(rid));
          if (toAdd.length > 0) {
            cfg = await updateGuildConfig(guildId, (c) => {
              const an = getAntiNukeConfig(c);
              an.globalWhitelistRoleIds = [...an.globalWhitelistRoleIds, ...toAdd];
              c.antiNukeConfig = an;
              return c;
            });
          }
          await i.update({ embeds: [buildAntiNukeGlobalWLEmbed(cfg)], components: antiNukeGlobalWLRows() });
          return;
        }

        if (id === "cfg:an:gwlClearUsers") {
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            an.globalWhitelistUserIds = [];
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeGlobalWLEmbed(cfg)], components: antiNukeGlobalWLRows() });
          return;
        }

        if (id === "cfg:an:gwlClearRoles") {
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            an.globalWhitelistRoleIds = [];
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeGlobalWLEmbed(cfg)], components: antiNukeGlobalWLRows() });
          return;
        }

        if (id === "cfg:an:miniSelect" && i.isStringSelectMenu()) {
          const miniId = i.values[0] as AntiNukeMiniId;
          cfg = await getGuildConfig(guildId);
          await i.update({ embeds: [buildAntiNukeMiniEmbed(cfg, miniId)], components: antiNukeMiniRows(cfg, miniId) });
          return;
        }

        if (id.startsWith("cfg:an:mini:toggle:")) {
          const miniId = id.slice("cfg:an:mini:toggle:".length) as AntiNukeMiniId;
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            (an[miniId] as any).enabled = !(an[miniId] as any).enabled;
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeMiniEmbed(cfg, miniId)], components: antiNukeMiniRows(cfg, miniId) });
          return;
        }

        if (id.startsWith("cfg:an:mini:punish:") && i.isStringSelectMenu()) {
          const miniId = id.slice("cfg:an:mini:punish:".length) as AntiNukeMiniId;
          const punishment = i.values[0] as AntiNukePunishment;
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            (an[miniId] as any).punishment = punishment;
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeMiniEmbed(cfg, miniId)], components: antiNukeMiniRows(cfg, miniId) });
          return;
        }

        if (id.startsWith("cfg:an:mini:wlUser:") && i.isUserSelectMenu()) {
          const miniId = id.slice("cfg:an:mini:wlUser:".length) as AntiNukeMiniId;
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            const existing = (an[miniId] as any).whitelistUserIds;
            (an[miniId] as any).whitelistUserIds = [...new Set([...existing, ...i.values])];
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeMiniEmbed(cfg, miniId)], components: antiNukeMiniRows(cfg, miniId) });
          return;
        }

        if (id.startsWith("cfg:an:mini:wlRole:") && i.isRoleSelectMenu()) {
          const miniId = id.slice("cfg:an:mini:wlRole:".length) as AntiNukeMiniId;
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            const existing = (an[miniId] as any).whitelistRoleIds;
            (an[miniId] as any).whitelistRoleIds = [...new Set([...existing, ...i.values])];
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeMiniEmbed(cfg, miniId)], components: antiNukeMiniRows(cfg, miniId) });
          return;
        }

        if (id.startsWith("cfg:an:mini:wlClear:")) {
          const miniId = id.slice("cfg:an:mini:wlClear:".length) as AntiNukeMiniId;
          cfg = await updateGuildConfig(guildId, (c) => {
            const an = getAntiNukeConfig(c);
            (an[miniId] as any).whitelistUserIds = [];
            (an[miniId] as any).whitelistRoleIds = [];
            c.antiNukeConfig = an;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeMiniEmbed(cfg, miniId)], components: antiNukeMiniRows(cfg, miniId) });
          return;
        }

        if (id === "cfg:an:mini:joinThreshold") {
          const modal = new ModalBuilder()
            .setCustomId("cfg:an:mini:joinThresholdModal")
            .setTitle("Anti-Join: Threshold & Window")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("threshold")
                  .setLabel("Join count before action (e.g. 3)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setValue(String(getAntiNukeConfig(cfg).antiJoin.threshold))
                  .setMinLength(1)
                  .setMaxLength(3),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("windowSeconds")
                  .setLabel("Time window in seconds (e.g. 60)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setValue(String(getAntiNukeConfig(cfg).antiJoin.windowSeconds))
                  .setMinLength(1)
                  .setMaxLength(6),
              ),
            );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({
              filter: (s) => s.customId === "cfg:an:mini:joinThresholdModal" && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
            const threshold = parseInt(submit.fields.getTextInputValue("threshold"), 10);
            const windowSeconds = parseInt(submit.fields.getTextInputValue("windowSeconds"), 10);
            if (!Number.isFinite(threshold) || threshold < 1 || !Number.isFinite(windowSeconds) || windowSeconds < 1) {
              await submit.reply({ content: "Both values must be positive integers.", flags: 1 << 6 });
              return;
            }
            cfg = await updateGuildConfig(guildId, (c) => {
              const an = getAntiNukeConfig(c);
              an.antiJoin.threshold = threshold;
              an.antiJoin.windowSeconds = windowSeconds;
              c.antiNukeConfig = an;
              return c;
            });
            if (submit.isFromMessage()) {
              await submit.update({ embeds: [buildAntiNukeMiniEmbed(cfg, "antiJoin")], components: antiNukeMiniRows(cfg, "antiJoin") });
            } else {
              await submit.reply({ content: `Anti-Join threshold set to **${threshold}** joins in **${windowSeconds}s**.`, flags: 1 << 6 });
            }
          } catch { /* timed out */ }
          return;
        }

        // ── Anti-Nuke Log Channel ────────────────────────────────────────────

        if (id === "cfg:an:setLogChannel") {
          const sel = new ChannelSelectMenuBuilder()
            .setCustomId("cfg:an:logChannelSet")
            .setPlaceholder("Pick the channel for Anti-Nuke logs")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setMinValues(1)
            .setMaxValues(1);
          const clearRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("cfg:an:logChannelClear")
              .setLabel("Clear Log Channel")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("cfg:an:overview")
              .setLabel("← Back")
              .setStyle(ButtonStyle.Secondary),
          );
          await i.update({
            embeds: [buildAntiNukeOverviewEmbed(cfg).setDescription("Select the channel where Anti-Nuke trigger events will be logged:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sel),
              clearRow,
            ],
          });
          return;
        }

        if (id === "cfg:an:logChannelSet" && i.isChannelSelectMenu()) {
          const channelId = i.values[0]!;
          cfg = await updateGuildConfig(guildId, (c) => {
            c.channels.antiNukeLog = channelId;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeOverviewEmbed(cfg)], components: antiNukeOverviewRows(cfg) });
          return;
        }

        if (id === "cfg:an:logChannelClear") {
          cfg = await updateGuildConfig(guildId, (c) => {
            delete c.channels.antiNukeLog;
            return c;
          });
          await i.update({ embeds: [buildAntiNukeOverviewEmbed(cfg)], components: antiNukeOverviewRows(cfg) });
          return;
        }

        // ── Shop ─────────────────────────────────────────────────────────────

        if (id === "cfg:shop:overview") {
          const ss = await getShopSettings(guildId);
          await i.update({ embeds: [buildShopOverviewEmbed(ss)], components: shopOverviewRows(ss) });
          return;
        }

        if (id === "cfg:shop:toggle") {
          const ss = await updateShopSettings(guildId, (s) => { s.enabled = !s.enabled; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ss)], components: shopOverviewRows(ss) });
          return;
        }

        if (id === "cfg:shop:addShop" && i.isButton()) {
          const modal = new ModalBuilder()
            .setCustomId("cfg:shop:addShopModal")
            .setTitle("Add New Shop");
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("name")
                .setLabel("Shop Name")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(32)
                .setPlaceholder("e.g. Boosting, Nitro Gifts"),
            ),
          );
          await i.showModal(modal);
          let addSubmit;
          try {
            addSubmit = await i.awaitModalSubmit({
              filter: (s) => s.customId === "cfg:shop:addShopModal" && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
          } catch { return; }
          const shopName = addSubmit.fields.getTextInputValue("name").trim();
          if (!shopName) { await addSubmit.reply({ content: "Shop name cannot be empty.", flags: 1 << 6 }); return; }
          const newShopId = generateShopId();
          const sAfterAdd = await updateShopSettings(guildId, (s) => {
            s.shops[newShopId] = { id: newShopId, name: shopName, questions: [], embed: {} };
            return s;
          });
          if (addSubmit.isFromMessage()) {
            await addSubmit.update({ embeds: [buildShopOverviewEmbed(sAfterAdd)], components: shopOverviewRows(sAfterAdd) });
          } else {
            await addSubmit.reply({ content: `${CE.success.str} Created shop **${shopName}**. Select it from the dropdown to configure it.`, flags: 1 << 6 });
          }
          return;
        }

        if (id === "cfg:shop:setModRoles" && i.isButton()) {
          const ssMod = await getShopSettings(guildId);
          const modRoleSel = new RoleSelectMenuBuilder()
            .setCustomId("cfg:shop:modRolesSet")
            .setPlaceholder("Select mod (staff) roles for the shop")
            .setMinValues(0).setMaxValues(10);
          await i.update({
            embeds: [buildShopOverviewEmbed(ssMod).setDescription("Select the **staff** roles that can see and claim shop tickets:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(modRoleSel),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId("cfg:shop:overview").setLabel("← Back").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }

        if (id === "cfg:shop:modRolesSet" && i.isRoleSelectMenu()) {
          const ssModSet = await updateShopSettings(guildId, (s) => { s.modRoleIds = i.values; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssModSet)], components: shopOverviewRows(ssModSet) });
          return;
        }

        if (id === "cfg:shop:setAdminRoles" && i.isButton()) {
          const ssAdm = await getShopSettings(guildId);
          const adminRoleSel = new RoleSelectMenuBuilder()
            .setCustomId("cfg:shop:adminRolesSet")
            .setPlaceholder("Select admin roles for the shop")
            .setMinValues(0).setMaxValues(10);
          await i.update({
            embeds: [buildShopOverviewEmbed(ssAdm).setDescription("Select the **admin** roles that retain access even after a ticket is claimed:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(adminRoleSel),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId("cfg:shop:overview").setLabel("← Back").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }

        if (id === "cfg:shop:adminRolesSet" && i.isRoleSelectMenu()) {
          const ssAdmSet = await updateShopSettings(guildId, (s) => { s.adminRoleIds = i.values; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssAdmSet)], components: shopOverviewRows(ssAdmSet) });
          return;
        }

        if (id === "cfg:shop:setLogChannel" && i.isButton()) {
          const ssLog = await getShopSettings(guildId);
          const logChSel = new ChannelSelectMenuBuilder()
            .setCustomId("cfg:shop:logChannelSet")
            .setPlaceholder("Pick the shop log channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setMinValues(1).setMaxValues(1);
          await i.update({
            embeds: [buildShopOverviewEmbed(ssLog).setDescription("Select the channel where shop ticket logs will be sent:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(logChSel),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId("cfg:shop:logChannelClear").setLabel("Clear").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId("cfg:shop:overview").setLabel("← Back").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }

        if (id === "cfg:shop:logChannelSet" && i.isChannelSelectMenu()) {
          const ssLogSet = await updateShopSettings(guildId, (s) => { s.logChannelId = i.values[0]; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssLogSet)], components: shopOverviewRows(ssLogSet) });
          return;
        }

        if (id === "cfg:shop:logChannelClear") {
          const ssLogClr = await updateShopSettings(guildId, (s) => { delete s.logChannelId; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssLogClr)], components: shopOverviewRows(ssLogClr) });
          return;
        }

        if (id === "cfg:shop:setTranscriptChannel" && i.isButton()) {
          const ssTx = await getShopSettings(guildId);
          const txChSel = new ChannelSelectMenuBuilder()
            .setCustomId("cfg:shop:transcriptChannelSet")
            .setPlaceholder("Pick the transcript channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setMinValues(1).setMaxValues(1);
          await i.update({
            embeds: [buildShopOverviewEmbed(ssTx).setDescription("Select the channel where ticket transcripts will be sent on close:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(txChSel),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId("cfg:shop:transcriptChannelClear").setLabel("Clear").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId("cfg:shop:overview").setLabel("← Back").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }

        if (id === "cfg:shop:transcriptChannelSet" && i.isChannelSelectMenu()) {
          const ssTxSet = await updateShopSettings(guildId, (s) => { s.transcriptChannelId = i.values[0]; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssTxSet)], components: shopOverviewRows(ssTxSet) });
          return;
        }

        if (id === "cfg:shop:transcriptChannelClear") {
          const ssTxClr = await updateShopSettings(guildId, (s) => { delete s.transcriptChannelId; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssTxClr)], components: shopOverviewRows(ssTxClr) });
          return;
        }

        if (id === "cfg:shop:setProofChannel" && i.isButton()) {
          const ssProof = await getShopSettings(guildId);
          const proofChSel = new ChannelSelectMenuBuilder()
            .setCustomId("cfg:shop:proofChannelSet")
            .setPlaceholder("Pick the proof channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setMinValues(1).setMaxValues(1);
          await i.update({
            embeds: [buildShopOverviewEmbed(ssProof).setDescription("Select the channel where sale proof messages will be sent:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(proofChSel),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId("cfg:shop:proofChannelClear").setLabel("Clear").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId("cfg:shop:overview").setLabel("← Back").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }

        if (id === "cfg:shop:proofChannelSet" && i.isChannelSelectMenu()) {
          const ssProofSet = await updateShopSettings(guildId, (s) => { s.proofChannelId = i.values[0]; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssProofSet)], components: shopOverviewRows(ssProofSet) });
          return;
        }

        if (id === "cfg:shop:proofChannelClear") {
          const ssProofClr = await updateShopSettings(guildId, (s) => { delete s.proofChannelId; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssProofClr)], components: shopOverviewRows(ssProofClr) });
          return;
        }

        if (id === "cfg:shop:setCustomerRole" && i.isButton()) {
          const ssCR = await getShopSettings(guildId);
          const crSel = new RoleSelectMenuBuilder()
            .setCustomId("cfg:shop:customerRoleSet")
            .setPlaceholder("Select the role given on first purchase")
            .setMinValues(1).setMaxValues(1);
          await i.update({
            embeds: [buildShopOverviewEmbed(ssCR).setDescription("Select the role that will be **automatically assigned** to a customer on their first successful purchase:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(crSel),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId("cfg:shop:overview").setLabel("← Back").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }

        if (id === "cfg:shop:customerRoleSet" && i.isRoleSelectMenu()) {
          const ssCRSet = await updateShopSettings(guildId, (s) => { s.customerRoleId = i.values[0]; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssCRSet)], components: shopOverviewRows(ssCRSet) });
          return;
        }

        if (id === "cfg:shop:customerRoleClear") {
          const ssCRClr = await updateShopSettings(guildId, (s) => { delete s.customerRoleId; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssCRClr)], components: shopOverviewRows(ssCRClr) });
          return;
        }

        if (id === "cfg:shop:shopSelect" && i.isStringSelectMenu()) {
          const selShopId = i.values[0]!;
          const ssShopSel = await getShopSettings(guildId);
          const selShop = ssShopSel.shops[selShopId];
          if (!selShop) { await i.update({ embeds: [buildShopOverviewEmbed(ssShopSel)], components: shopOverviewRows(ssShopSel) }); return; }
          await i.update({ embeds: [buildShopMiniEmbed(selShop, ssShopSel)], components: shopMiniRows(selShop) });
          return;
        }

        // ── Shop mini — per-shop config ───────────────────────────────────────

        if (id.startsWith("cfg:shop:mini:back:") || id === "cfg:shop:mini:back") {
          const ssMiniBack = await getShopSettings(guildId);
          await i.update({ embeds: [buildShopOverviewEmbed(ssMiniBack)], components: shopOverviewRows(ssMiniBack) });
          return;
        }

        if (id.startsWith("cfg:shop:mini:setChannel:") && i.isButton()) {
          const miniChShopId = id.slice("cfg:shop:mini:setChannel:".length);
          const ssMiniCh = await getShopSettings(guildId);
          const miniChShop = ssMiniCh.shops[miniChShopId];
          if (!miniChShop) return;
          const miniChSel = new ChannelSelectMenuBuilder()
            .setCustomId(`cfg:shop:mini:channelSet:${miniChShopId}`)
            .setPlaceholder("Select the channel for the shop embed")
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(1).setMaxValues(1);
          await i.update({
            embeds: [buildShopMiniEmbed(miniChShop, ssMiniCh).setDescription("Pick the **text channel** where the buy button embed will be posted:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(miniChSel),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`cfg:shop:mini:back:${miniChShopId}`).setLabel("← Back").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }

        if (id.startsWith("cfg:shop:mini:channelSet:") && i.isChannelSelectMenu()) {
          const miniChSetId = id.slice("cfg:shop:mini:channelSet:".length);
          const ssMiniChSet = await updateShopSettings(guildId, (s) => {
            if (s.shops[miniChSetId]) s.shops[miniChSetId].channelId = i.values[0];
            return s;
          });
          const miniChSetShop = ssMiniChSet.shops[miniChSetId];
          if (!miniChSetShop) return;
          await i.update({ embeds: [buildShopMiniEmbed(miniChSetShop, ssMiniChSet)], components: shopMiniRows(miniChSetShop) });
          return;
        }

        if (id.startsWith("cfg:shop:mini:setCategory:") && i.isButton()) {
          const miniCatId = id.slice("cfg:shop:mini:setCategory:".length);
          const ssMiniCat = await getShopSettings(guildId);
          const miniCatShop = ssMiniCat.shops[miniCatId];
          if (!miniCatShop) return;
          const miniCatSel = new ChannelSelectMenuBuilder()
            .setCustomId(`cfg:shop:mini:categorySet:${miniCatId}`)
            .setPlaceholder("Select the ticket channel category")
            .addChannelTypes(ChannelType.GuildCategory)
            .setMinValues(1).setMaxValues(1);
          await i.update({
            embeds: [buildShopMiniEmbed(miniCatShop, ssMiniCat).setDescription("Pick the **category** where ticket channels will be created (optional):")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(miniCatSel),
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`cfg:shop:mini:clearCategory:${miniCatId}`).setLabel("No Category").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`cfg:shop:mini:back:${miniCatId}`).setLabel("← Back").setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
          return;
        }

        if (id.startsWith("cfg:shop:mini:categorySet:") && i.isChannelSelectMenu()) {
          const miniCatSetId = id.slice("cfg:shop:mini:categorySet:".length);
          const ssMiniCatSet = await updateShopSettings(guildId, (s) => {
            if (s.shops[miniCatSetId]) s.shops[miniCatSetId].categoryId = i.values[0];
            return s;
          });
          const miniCatSetShop = ssMiniCatSet.shops[miniCatSetId];
          if (!miniCatSetShop) return;
          await i.update({ embeds: [buildShopMiniEmbed(miniCatSetShop, ssMiniCatSet)], components: shopMiniRows(miniCatSetShop) });
          return;
        }

        if (id.startsWith("cfg:shop:mini:clearCategory:")) {
          const miniCatClrId = id.slice("cfg:shop:mini:clearCategory:".length);
          const ssMiniCatClr = await updateShopSettings(guildId, (s) => {
            if (s.shops[miniCatClrId]) delete s.shops[miniCatClrId].categoryId;
            return s;
          });
          const miniCatClrShop = ssMiniCatClr.shops[miniCatClrId];
          if (!miniCatClrShop) return;
          await i.update({ embeds: [buildShopMiniEmbed(miniCatClrShop, ssMiniCatClr)], components: shopMiniRows(miniCatClrShop) });
          return;
        }

        if (id.startsWith("cfg:shop:mini:editQuestions:") && i.isButton()) {
          const miniQId = id.slice("cfg:shop:mini:editQuestions:".length);
          const ssMiniQ = await getShopSettings(guildId);
          const miniQShop = ssMiniQ.shops[miniQId];
          if (!miniQShop) return;

          const qModal = new ModalBuilder()
            .setCustomId(`cfg:shop:mini:questionsModal:${miniQId}`)
            .setTitle(`Questions — ${miniQShop.name}`.slice(0, 45));
          const qLabels = ["Question 1 (required)", "Question 2", "Question 3", "Question 4", "Question 5"];
          for (let qi = 0; qi < 5; qi++) {
            qModal.addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId(`q${qi}`)
                  .setLabel(qLabels[qi])
                  .setStyle(TextInputStyle.Short)
                  .setRequired(qi === 0)
                  .setMaxLength(100)
                  .setValue(miniQShop.questions[qi] ?? ""),
              ),
            );
          }
          await i.showModal(qModal);
          let qSubmit;
          try {
            qSubmit = await i.awaitModalSubmit({
              filter: (s) => s.customId === `cfg:shop:mini:questionsModal:${miniQId}` && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
          } catch { return; }

          const newQuestions = [0, 1, 2, 3, 4]
            .map((qi) => qSubmit.fields.getTextInputValue(`q${qi}`).trim())
            .filter(Boolean);
          const ssMiniQUpd = await updateShopSettings(guildId, (s) => {
            if (s.shops[miniQId]) s.shops[miniQId].questions = newQuestions;
            return s;
          });
          const miniQUpdShop = ssMiniQUpd.shops[miniQId];
          if (!miniQUpdShop) return;
          if (qSubmit.isFromMessage()) {
            await qSubmit.update({ embeds: [buildShopMiniEmbed(miniQUpdShop, ssMiniQUpd)], components: shopMiniRows(miniQUpdShop) });
          } else {
            await qSubmit.reply({ content: `${CE.success.str} Saved **${newQuestions.length}** question(s).`, flags: 1 << 6 });
          }
          return;
        }

        if (id.startsWith("cfg:shop:mini:editEmbed:") && i.isButton()) {
          const miniEmbId = id.slice("cfg:shop:mini:editEmbed:".length);
          const ssMiniEmb = await getShopSettings(guildId);
          const miniEmbShop = ssMiniEmb.shops[miniEmbId];
          if (!miniEmbShop) return;

          const embModal = new ModalBuilder()
            .setCustomId(`cfg:shop:mini:embedModal:${miniEmbId}`)
            .setTitle(`Edit Embed — ${miniEmbShop.name}`.slice(0, 45));
          embModal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("title").setLabel("Embed Title").setStyle(TextInputStyle.Short)
                .setRequired(false).setMaxLength(256).setValue(miniEmbShop.embed.title ?? ""),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("description").setLabel("Description").setStyle(TextInputStyle.Paragraph)
                .setRequired(false).setMaxLength(2000).setValue(miniEmbShop.embed.description ?? ""),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("thumbnail").setLabel("Thumbnail URL (blank = remove)").setStyle(TextInputStyle.Short)
                .setRequired(false).setMaxLength(300).setValue(miniEmbShop.embed.thumbnail ?? ""),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("image").setLabel("Large Image URL (blank = remove)").setStyle(TextInputStyle.Short)
                .setRequired(false).setMaxLength(300).setValue(miniEmbShop.embed.image ?? ""),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("footer").setLabel("Footer Text (blank = remove)").setStyle(TextInputStyle.Short)
                .setRequired(false).setMaxLength(200).setValue(miniEmbShop.embed.footer ?? ""),
            ),
          );
          await i.showModal(embModal);
          let embSubmit;
          try {
            embSubmit = await i.awaitModalSubmit({
              filter: (s) => s.customId === `cfg:shop:mini:embedModal:${miniEmbId}` && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
          } catch { return; }

          const embTitle = embSubmit.fields.getTextInputValue("title").trim() || undefined;
          const embDesc = embSubmit.fields.getTextInputValue("description").trim() || undefined;
          const embThumb = embSubmit.fields.getTextInputValue("thumbnail").trim() || undefined;
          const embImg = embSubmit.fields.getTextInputValue("image").trim() || undefined;
          const embFooter = embSubmit.fields.getTextInputValue("footer").trim() || undefined;

          const ssMiniEmbUpd = await updateShopSettings(guildId, (s) => {
            if (s.shops[miniEmbId]) {
              s.shops[miniEmbId].embed = {
                ...s.shops[miniEmbId].embed,
                title: embTitle, description: embDesc,
                thumbnail: embThumb, image: embImg, footer: embFooter,
              };
            }
            return s;
          });
          const miniEmbUpdShop = ssMiniEmbUpd.shops[miniEmbId];
          if (!miniEmbUpdShop) return;
          if (embSubmit.isFromMessage()) {
            await embSubmit.update({ embeds: [buildShopMiniEmbed(miniEmbUpdShop, ssMiniEmbUpd)], components: shopMiniRows(miniEmbUpdShop) });
          } else {
            await embSubmit.reply({ content: `${CE.success.str} Embed settings saved for **${miniEmbUpdShop.name}**.`, flags: 1 << 6 });
          }
          return;
        }

        if (id.startsWith("cfg:shop:mini:postEmbed:") && i.isButton()) {
          const miniPostId = id.slice("cfg:shop:mini:postEmbed:".length);
          const ssMiniPost = await getShopSettings(guildId);
          const miniPostShop = ssMiniPost.shops[miniPostId];
          if (!miniPostShop) return;

          if (!miniPostShop.channelId) {
            await i.reply({ content: `${CE.error.str} Set the shop channel first before posting.`, flags: 1 << 6 });
            return;
          }
          const postTargetCh = i.guild?.channels.cache.get(miniPostShop.channelId) as TextChannel | undefined;
          if (!postTargetCh) {
            await i.reply({ content: `${CE.error.str} The configured channel no longer exists.`, flags: 1 << 6 });
            return;
          }

          const shopEmbed = new EmbedBuilder()
            .setTitle(miniPostShop.embed.title ?? miniPostShop.name)
            .setDescription(miniPostShop.embed.description ?? `Click below to open a ticket and purchase from **${miniPostShop.name}**!`)
            .setColor(0x5865f2)
            .setTimestamp();
          if (miniPostShop.embed.thumbnail) shopEmbed.setThumbnail(miniPostShop.embed.thumbnail);
          if (miniPostShop.embed.image) shopEmbed.setImage(miniPostShop.embed.image);
          if (miniPostShop.embed.footer) shopEmbed.setFooter({ text: miniPostShop.embed.footer });
          if (miniPostShop.embed.fields?.length) {
            shopEmbed.addFields(miniPostShop.embed.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline })));
          }

          const shopStatus = miniPostShop.status ?? "active";
          const statusColor = shopStatus === "out_of_stock" ? 0xed4245 : shopStatus === "coming_soon" ? 0xfee75c : 0x5865f2;
          shopEmbed.setColor(statusColor);

          let statusRow: ActionRowBuilder<MessageActionRowComponentBuilder>;
          if (shopStatus === "coming_soon") {
            statusRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId("shop:status_noop")
                .setLabel("Coming Soon")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(CE.limited.str)
                .setDisabled(true),
            );
          } else if (shopStatus === "out_of_stock") {
            statusRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId("shop:status_noop")
                .setLabel("Out of Stock")
                .setStyle(ButtonStyle.Danger)
                .setEmoji(CE.discount.str)
                .setDisabled(true),
            );
          } else {
            statusRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`shop:buy:${guildId}:${miniPostId}`)
                .setLabel(`Purchase — ${miniPostShop.name}`.slice(0, 80))
                .setStyle(ButtonStyle.Success)
                .setEmoji(CE.shoppingcart.str),
            );
          }

          await i.deferUpdate();
          try {
            if (miniPostShop.messageId) {
              const oldPostMsg = await postTargetCh.messages.fetch(miniPostShop.messageId).catch(() => null);
              if (oldPostMsg) await oldPostMsg.delete().catch(() => {});
            }
            const postedMsg = await postTargetCh.send({ embeds: [shopEmbed], components: [statusRow] });
            const ssMiniPostUpd = await updateShopSettings(guildId, (s) => {
              if (s.shops[miniPostId]) s.shops[miniPostId].messageId = postedMsg.id;
              return s;
            });
            const miniPostUpdShop = ssMiniPostUpd.shops[miniPostId];
            if (!miniPostUpdShop) return;
            await i.editReply({ embeds: [buildShopMiniEmbed(miniPostUpdShop, ssMiniPostUpd)], components: shopMiniRows(miniPostUpdShop) });
          } catch (postErr) {
            logger.error({ postErr }, "[Shop Config] Failed to post embed");
            await i.editReply({ content: `${CE.error.str} Failed to post — check bot send permissions in that channel.` }).catch(() => {});
          }
          return;
        }

        if (id.startsWith("cfg:shop:mini:statusSet:") && i.isStringSelectMenu()) {
          const miniStatId = id.slice("cfg:shop:mini:statusSet:".length);
          const newStatus = i.values[0] as ShopStatus;
          const ssMiniStat = await updateShopSettings(guildId, (s) => {
            if (s.shops[miniStatId]) s.shops[miniStatId].status = newStatus;
            return s;
          });
          const miniStatShop = ssMiniStat.shops[miniStatId];
          if (!miniStatShop) return;
          await i.update({ embeds: [buildShopMiniEmbed(miniStatShop, ssMiniStat)], components: shopMiniRows(miniStatShop) });
          return;
        }

        if (id.startsWith("cfg:shop:mini:delete:") && i.isButton()) {
          const miniDelId = id.slice("cfg:shop:mini:delete:".length);
          const ssMiniDel = await getShopSettings(guildId);
          const miniDelShop = ssMiniDel.shops[miniDelId];
          if (!miniDelShop) return;
          await i.update({
            embeds: [new EmbedBuilder()
              .setTitle("Delete Shop")
              .setDescription(`Are you sure you want to delete **${miniDelShop.name}**?\n\nThis cannot be undone. Existing tickets will remain but no new ones can be opened.`)
              .setColor(0xed4245)],
            components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
              new ButtonBuilder().setCustomId(`cfg:shop:mini:confirmDelete:${miniDelId}`).setLabel("Yes, Delete").setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`cfg:shop:mini:back:${miniDelId}`).setLabel("← Cancel").setStyle(ButtonStyle.Secondary),
            )],
          });
          return;
        }

        if (id.startsWith("cfg:shop:mini:confirmDelete:")) {
          const miniConfDelId = id.slice("cfg:shop:mini:confirmDelete:".length);
          const ssMiniConfDel = await updateShopSettings(guildId, (s) => { delete s.shops[miniConfDelId]; return s; });
          await i.update({ embeds: [buildShopOverviewEmbed(ssMiniConfDel)], components: shopOverviewRows(ssMiniConfDel) });
          return;
        }

        // ── Custom Prefix ────────────────────────────────────────────────────

        if (id === "cfg:prefix:set") {
          cfg = await getGuildConfig(guildId);
          await i.showModal(prefixModal(cfg));
          let submit;
          try {
            submit = await i.awaitModalSubmit({
              filter: (s) => s.customId === "cfg:prefix:modal" && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
          } catch { return; }
          const newPrefix = submit.fields.getTextInputValue("prefix").trim();
          if (!newPrefix) {
            await submit.reply({ content: "Prefix cannot be empty.", flags: 1 << 6 });
            return;
          }
          cfg = await updateGuildConfig(guildId, (c) => { c.guildPrefix = newPrefix; return c; });
          if (submit.isFromMessage()) {
            await safeSubmitUpdate(submit, { embeds: [buildPrefixEmbed(cfg)], components: prefixRows(cfg) });
          } else {
            await submit.reply({ content: `Prefix set to \`${newPrefix}\`. DM command is now \`${newPrefix}n\`.`, flags: 1 << 6 });
          }
          return;
        }

        if (id === "cfg:prefix:reset") {
          cfg = await updateGuildConfig(guildId, (c) => { delete c.guildPrefix; return c; });
          await safeUpdate(i, { embeds: [buildPrefixEmbed(cfg)], components: prefixRows(cfg) });
          return;
        }

        // ── Bot Profile ──────────────────────────────────────────────────────

        if (id === "cfg:botProfile:set") {
          const currentNick = i.guild?.members.me?.nickname ?? null;
          await i.showModal(botProfileModal(currentNick));
          let submit;
          try {
            submit = await i.awaitModalSubmit({
              filter: (s) => s.customId === "cfg:botProfile:modal" && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
          } catch { return; }

          const nickname = submit.fields.getTextInputValue("nickname").trim();
          const results: string[] = [];

          if (i.guild?.members.me) {
            try {
              await i.guild.members.me.setNickname(nickname || null);
              results.push(nickname ? `Nickname set to **${nickname}**` : "Nickname cleared");
            } catch {
              results.push(`${CE.error.str} Could not set nickname — missing **Manage Nicknames** permission`);
            }
          }

          const me = i.guild?.members.me;
          const updatedNote = results.join("\n") || "No changes made.";
          if (submit.isFromMessage()) {
            await safeSubmitUpdate(submit, {
              embeds: [buildBotProfileEmbed(me?.nickname ?? null, me?.displayAvatarURL() ?? "", updatedNote)],
              components: botProfileRows(),
            });
          } else {
            await submit.reply({ content: updatedNote, flags: 1 << 6 });
          }
          return;
        }

        if (id === "cfg:botProfile:resetNickname") {
          try {
            await i.guild?.members.me?.setNickname(null);
          } catch { /* Missing permissions — ignore */ }
          const me = i.guild?.members.me;
          await safeUpdate(i, {
            embeds: [buildBotProfileEmbed(me?.nickname ?? null, me?.displayAvatarURL() ?? "", "Nickname has been cleared.")],
            components: botProfileRows(),
          });
          return;
        }

        // ── Module: toggle / channel / roles ────────────────────────────────

        if (id.startsWith("cfg:mod:toggle:")) {
          const modId = id.slice("cfg:mod:toggle:".length);
          const mod = MODULE_DEFS.find((m) => m.id === modId);
          if (!mod) return;
          cfg = await updateGuildConfig(guildId, (c) => {
            c.modules[mod.moduleKey] = !c.modules[mod.moduleKey];
            return c;
          });
          await safeUpdate(i, { embeds: [buildModuleEmbed(cfg, mod)], components: moduleActionRows(cfg, mod) });
          return;
        }

        if (id.startsWith("cfg:mod:setchannel:")) {
          const modId = id.slice("cfg:mod:setchannel:".length);
          const mod = MODULE_DEFS.find((m) => m.id === modId);
          if (!mod || !mod.channelKey) return;
          await safeUpdate(i, {
            embeds: [buildModuleEmbed(cfg, mod).setDescription("Select a channel below:")],
            components: channelPickRows(mod),
          });
          return;
        }

        if (id.startsWith("cfg:mod:channelset:") && i.isChannelSelectMenu()) {
          const modId = id.slice("cfg:mod:channelset:".length);
          const mod = MODULE_DEFS.find((m) => m.id === modId);
          if (!mod || !mod.channelKey) return;
          const channelId = i.values[0]!;
          const key = mod.channelKey;
          cfg = await updateGuildConfig(guildId, (c) => {
            c.channels[key] = channelId;
            return c;
          });
          await safeUpdate(i, { embeds: [buildModuleEmbed(cfg, mod)], components: moduleActionRows(cfg, mod) });
          return;
        }

        if (id.startsWith("cfg:mod:channelclear:")) {
          const modId = id.slice("cfg:mod:channelclear:".length);
          const mod = MODULE_DEFS.find((m) => m.id === modId);
          if (!mod || !mod.channelKey) return;
          const key = mod.channelKey;
          cfg = await updateGuildConfig(guildId, (c) => {
            delete c.channels[key];
            return c;
          });
          await safeUpdate(i, { embeds: [buildModuleEmbed(cfg, mod)], components: moduleActionRows(cfg, mod) });
          return;
        }

        if (id === "cfg:partnership:setAnnounce") {
          const mod = MODULE_DEFS.find((m) => m.id === "partnership")!;
          const sel = new ChannelSelectMenuBuilder()
            .setCustomId("cfg:partnership:announceSet")
            .setPlaceholder("Pick the channel where approved partnerships are announced")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setMinValues(1)
            .setMaxValues(1);
          const clearRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("cfg:partnership:announceClear")
              .setLabel("Clear Channel")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("cfg:settings:view:partnership")
              .setLabel("← Back")
              .setStyle(ButtonStyle.Secondary),
          );
          await safeUpdate(i, {
            embeds: [buildModuleEmbed(cfg, mod).setDescription("Select the channel where approved partnerships will be announced:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(sel),
              clearRow,
            ],
          });
          return;
        }

        if (id === "cfg:partnership:announceSet" && i.isChannelSelectMenu()) {
          const mod = MODULE_DEFS.find((m) => m.id === "partnership")!;
          const channelId = i.values[0]!;
          cfg = await updateGuildConfig(guildId, (c) => {
            c.channels.partnership = channelId;
            return c;
          });
          await safeUpdate(i, { embeds: [buildSettingsEmbed(cfg, "partnership")], components: settingsRows(cfg, "partnership") });
          return;
        }

        if (id === "cfg:partnership:announceClear") {
          cfg = await updateGuildConfig(guildId, (c) => {
            delete c.channels.partnership;
            return c;
          });
          await safeUpdate(i, { embeds: [buildSettingsEmbed(cfg, "partnership")], components: settingsRows(cfg, "partnership") });
          return;
        }

        if (id === "cfg:verify:sendEmbed") {
          const channelId = cfg.channels.verifyChannel;
          if (!channelId) {
            await i.reply({ content: "No verify channel set. Please set one first.", ephemeral: true });
            return;
          }
          try {
            const channel = await i.guild!.channels.fetch(channelId) as TextChannel;
            const promptMessage = "**Verify yourself to access the server!**\n\nClick the button below to start verification.";
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId("verify_prompt")
                .setLabel("Verify Now")
                .setStyle(ButtonStyle.Success),
            );
            await channel.send({ content: promptMessage, components: [row] });
            await i.reply({ content: "Verification embed sent to the channel.", ephemeral: true });
          } catch (err) {
            await i.reply({ content: "Failed to send embed to the channel.", ephemeral: true });
          }
          return;
        }

        if (id.startsWith("cfg:mod:setroles:")) {
          const modId = id.slice("cfg:mod:setroles:".length);
          const mod = MODULE_DEFS.find((m) => m.id === modId);
          if (!mod) return;
          await safeUpdate(i, {
            embeds: [buildModuleEmbed(cfg, mod).setDescription("Select permitted roles below:")],
            components: rolePickRows(mod),
          });
          return;
        }

        if (id.startsWith("cfg:mod:roleset:") && i.isRoleSelectMenu()) {
          const modId = id.slice("cfg:mod:roleset:".length);
          const mod = MODULE_DEFS.find((m) => m.id === modId);
          if (!mod) return;
          const roleIds = Array.from(i.values);
          cfg = await updateGuildConfig(guildId, (c) => {
            if (!c.moduleRoles) c.moduleRoles = {};
            c.moduleRoles[modId] = roleIds;
            return c;
          });
          await safeUpdate(i, { embeds: [buildModuleEmbed(cfg, mod)], components: moduleActionRows(cfg, mod) });
          return;
        }

        if (id.startsWith("cfg:mod:roleclear:")) {
          const modId = id.slice("cfg:mod:roleclear:".length);
          const mod = MODULE_DEFS.find((m) => m.id === modId);
          if (!mod) return;
          cfg = await updateGuildConfig(guildId, (c) => {
            if (!c.moduleRoles) c.moduleRoles = {};
            c.moduleRoles[modId] = [];
            return c;
          });
          await safeUpdate(i, { embeds: [buildModuleEmbed(cfg, mod)], components: moduleActionRows(cfg, mod) });
          return;
        }

        // ── Per-module settings ─────────────────────────────────────────────

        if (id.startsWith("cfg:settings:view:")) {
          const modId = id.slice("cfg:settings:view:".length);
          cfg = await getGuildConfig(guildId);
          await safeUpdate(i, {
            embeds: [buildSettingsEmbed(cfg, modId)],
            components: settingsRows(cfg, modId),
          });
          return;
        }

        if (id.startsWith("cfg:settings:toggle:")) {
          const rest = id.slice("cfg:settings:toggle:".length);
          const colonIdx = rest.indexOf(":");
          if (colonIdx === -1) return;
          const modId = rest.slice(0, colonIdx);
          const field = rest.slice(colonIdx + 1);

          cfg = await updateGuildConfig(guildId, (c) => {
            switch (modId) {
              case "infractions": {
                const s = c.infractionsConfig ?? {
                  strikeExpiryDays: 30,
                  dmOnInfraction: true,
                  autoDemotionEnabled: true,
                  strikeAction1: "warning" as const,
                  strikeAction2: "strike" as const,
                  strikeAction3plus: "termination" as const,
                };
                if (field === "dmOnInfraction")      s.dmOnInfraction      = !s.dmOnInfraction;
                if (field === "autoDemotionEnabled") s.autoDemotionEnabled = !s.autoDemotionEnabled;
                c.infractionsConfig = s;
                break;
              }
              case "moderation": {
                const s = c.moderationConfig ?? { dmOnAction: true };
                if (field === "dmOnAction") s.dmOnAction = !s.dmOnAction;
                c.moderationConfig = s;
                break;
              }
              case "promotions": {
                const s = c.promotionsConfig ?? { dmMember: true };
                if (field === "dmMember") s.dmMember = !s.dmMember;
                c.promotionsConfig = s;
                break;
              }
              case "demotions": {
                const s = c.demotionsConfig ?? { dmMember: true };
                if (field === "dmMember") s.dmMember = !s.dmMember;
                c.demotionsConfig = s;
                break;
              }
              case "loa": {
                const s = c.loaConfig ?? { maxDurationDays: 0, requireReason: true };
                if (field === "requireReason") s.requireReason = !s.requireReason;
                c.loaConfig = s;
                break;
              }
              case "antiNuke": {
                const s = getAntiNukeConfig(c);
                if (field === "antiJoins") s.antiJoin.enabled = !s.antiJoin.enabled;
                if (field === "antiBans") s.antiBan.enabled = !s.antiBan.enabled;
                if (field === "antiKicks") s.antiKick.enabled = !s.antiKick.enabled;
                if (field === "antiRoleChanges") s.antiRole.enabled = !s.antiRole.enabled;
                if (field === "antiChannelChanges") s.antiChannel.enabled = !s.antiChannel.enabled;
                c.antiNukeConfig = s;
                break;
              }
            }
            return c;
          });

          await safeUpdate(i, {
            embeds: [buildSettingsEmbed(cfg, modId)],
            components: settingsRows(cfg, modId),
          });
          return;
        }

        if (id.startsWith("cfg:settings:modal:")) {
          const modId = id.slice("cfg:settings:modal:".length);
          cfg = await getGuildConfig(guildId);
          const modal = buildSettingsModal(cfg, modId);
          if (!modal) return;
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({
              filter: (s) => s.customId === `cfg:settings:modalResult:${modId}` && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
            cfg = await updateGuildConfig(guildId, (c) => {
              switch (modId) {
                case "infractions": {
                  const v = parseInt(submit.fields.getTextInputValue("strikeExpiryDays"), 10);
                  const validActions = new Set<FailureAction>(["none", "warning", "strike", "demotion", "termination"]);
                  const toAction = (raw: string): FailureAction => {
                    const trimmed = raw.trim().toLowerCase() as FailureAction;
                    return validActions.has(trimmed) ? trimmed : "none";
                  };
                  const sa1 = toAction(submit.fields.getTextInputValue("strikeAction1"));
                  const sa2 = toAction(submit.fields.getTextInputValue("strikeAction2"));
                  const sa3 = toAction(submit.fields.getTextInputValue("strikeAction3plus"));
                  const existingInf = c.infractionsConfig ?? {
                    strikeExpiryDays: 30,
                    dmOnInfraction: true,
                    autoDemotionEnabled: true,
                    strikeAction1: "warning" as const,
                    strikeAction2: "strike" as const,
                    strikeAction3plus: "termination" as const,
                  };
                  c.infractionsConfig = {
                    ...existingInf,
                    strikeExpiryDays: Number.isFinite(v) && v >= 0 ? v : existingInf.strikeExpiryDays,
                    strikeAction1: sa1,
                    strikeAction2: sa2,
                    strikeAction3plus: sa3,
                  };
                  break;
                }
                case "appeals": {
                  const v = parseInt(submit.fields.getTextInputValue("autoCloseDays"), 10);
                  if (Number.isFinite(v) && v >= 0) {
                    c.appealsConfig = { autoCloseDays: v };
                  }
                  break;
                }
                case "loa": {
                  const v = parseInt(submit.fields.getTextInputValue("maxDurationDays"), 10);
                  if (Number.isFinite(v) && v >= 0) {
                    c.loaConfig = {
                      ...(c.loaConfig ?? { requireReason: true }),
                      maxDurationDays: v,
                    };
                  }
                  break;
                }
                case "partnership": {
                  const quota = parseInt(submit.fields.getTextInputValue("quota"), 10);
                  const f1 = submit.fields.getTextInputValue("failureAction1").trim().toLowerCase();
                  const f2 = submit.fields.getTextInputValue("failureAction2").trim().toLowerCase();
                  const f3 = submit.fields.getTextInputValue("failureAction3").trim().toLowerCase();
                  const validActions = new Set(["none", "warning", "strike", "demotion", "termination"]);
                  if (Number.isFinite(quota) && quota >= 0) {
                    c.partnershipConfig = {
                      ...(c.partnershipConfig ?? { quota: 0, failureActions: { 1: "none", 2: "none", 3: "none" } }),
                      quota,
                      failureActions: {
                        1: validActions.has(f1) ? f1 as PartnershipConfig["failureActions"][1] : "none",
                        2: validActions.has(f2) ? f2 as PartnershipConfig["failureActions"][2] : "none",
                        3: validActions.has(f3) ? f3 as PartnershipConfig["failureActions"][3] : "none",
                      },
                    };
                  }
                  break;
                }
                case "antiNuke": {
                  const value = submit.fields.getTextInputValue("punishmentAction").trim().toLowerCase() as AntiNukePunishment;
                  const validActions = new Set<AntiNukePunishment>(["none", "kick", "ban", "timeout_1h", "timeout_24h", "timeout_7d"]);
                  const s = getAntiNukeConfig(c);
                  s.commonPunishment = validActions.has(value) ? value : "none";
                  c.antiNukeConfig = s;
                  break;
                }
              }
              return c;
            });
            if (submit.isFromMessage()) {
              await safeSubmitUpdate(submit, {
                embeds: [buildSettingsEmbed(cfg, modId)],
                components: settingsRows(cfg, modId),
              });
            } else {
              await submit.reply({ content: "Settings saved.", flags: 1 << 6 });
            }
          } catch {
            // timed out or dismissed
          }
          return;
        }

        if (id === "cfg:antiNuke:setUsers") {
          cfg = await getGuildConfig(guildId);
          const modal = buildAntiNukeUsersModal(cfg);
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({
              filter: (s) => s.customId === "cfg:antiNuke:usersModalResult" && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
            const raw = submit.fields.getTextInputValue("whitelistedUserIds");
            const userIds = raw
              .split(/[\s,]+/)
              .map((value) => value.trim())
              .filter((value) => value.length > 0);
            cfg = await updateGuildConfig(guildId, (c) => {
              const s = getAntiNukeConfig(c);
              s.globalWhitelistUserIds = userIds;
              c.antiNukeConfig = s;
              return c;
            });
            if (submit.isFromMessage()) {
              await safeSubmitUpdate(submit, {
                embeds: [buildSettingsEmbed(cfg, "antiNuke")],
                components: settingsRows(cfg, "antiNuke"),
              });
            } else {
              await submit.reply({ content: "Anti-nuke whitelist saved.", flags: 1 << 6 });
            }
          } catch {
            // timed out or dismissed
          }
          return;
        }

        if (id === "cfg:staffReport:intervalSelect" && i.isStringSelectMenu()) {
          const hours = Number(i.values[0]);
          if (Number.isFinite(hours) && hours >= 1) {
            cfg = await updateGuildConfig(guildId, (c) => {
              c.staffReportConfig = { refreshIntervalHours: hours };
              return c;
            });
          }
          await safeUpdate(i, {
            embeds: [buildSettingsEmbed(cfg, "staffReport")],
            components: settingsRows(cfg, "staffReport"),
          });
          return;
        }

        // ── Appeals: set invite ─────────────────────────────────────────────

        if (id === "cfg:appeals:setInvite") {
          const appealsMod = MODULE_DEFS.find((m) => m.id === "appeals")!;
          const modal = new ModalBuilder()
            .setCustomId("cfg:appeals:inviteModal")
            .setTitle("Set Appeal Server Invite")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("invite")
                  .setLabel("Invite URL (blank = clear)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(false)
                  .setPlaceholder("https://discord.gg/...")
                  .setValue(cfg.appealServerInvite ?? ""),
              ),
            );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({
              filter: (s) => s.customId === "cfg:appeals:inviteModal" && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
            const invite = submit.fields.getTextInputValue("invite").trim();
            cfg = await updateGuildConfig(guildId, (c) => {
              if (invite) c.appealServerInvite = invite;
              else delete c.appealServerInvite;
              return c;
            });
            if (submit.isFromMessage()) {
              await safeSubmitUpdate(submit, {
                embeds: [buildModuleEmbed(cfg, appealsMod)],
                components: moduleActionRows(cfg, appealsMod),
              });
            } else {
              await submit.reply({
                content: invite ? `Appeal server invite set to ${invite}` : "Appeal server invite cleared.",
                flags: 1 << 6,
              });
            }
          } catch {
            /* timed out or dismissed */
          }
          return;
        }

        // ── Quota: handlers ─────────────────────────────────────────────────

        if (id === "cfg:quotaSet") {
          await i.showModal(quotaModal(cfg));
          try {
            const submit = await i.awaitModalSubmit({
              filter: (s) => s.customId === "cfg:quotaModal" && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
            const messages = parseInt(submit.fields.getTextInputValue("messages"), 10);
            const modActions = parseInt(submit.fields.getTextInputValue("modActions"), 10);
            if (!Number.isFinite(messages) || messages < 0 || !Number.isFinite(modActions) || modActions < 0) {
              await submit.reply({ content: "Both values must be non-negative integers.", flags: 1 << 6 });
              return;
            }
            cfg = await updateGuildConfig(guildId, (c) => {
              const day = c.quotaConfig?.weekStartDay ?? 0;
              c.quotaConfig = { messages, modActions, weekStartDay: day };
              return c;
            });
            if (submit.isFromMessage()) {
              await safeSubmitUpdate(submit, { embeds: [buildQuotaEmbed(cfg)], components: quotaRows(cfg) });
            } else {
              await submit.reply({
                content: `Quota set: **${messages}** messages / **${modActions}** mod actions per week.`,
                flags: 1 << 6,
              });
            }
          } catch {
            // timed out or dismissed
          }
          return;
        }

        if (id === "cfg:quotaClear") {
          cfg = await updateGuildConfig(guildId, (c) => { delete c.quotaConfig; return c; });
          await safeUpdate(i, { embeds: [buildQuotaEmbed(cfg)], components: quotaRows(cfg) });
          return;
        }

        if (id === "cfg:quotaDay") {
          await safeUpdate(i, { embeds: [buildQuotaEmbed(cfg)], components: weekStartRows(cfg) });
          return;
        }

        if (id === "cfg:quotaWhitelist") {
          const roleNameMap = new Map(i.guild?.roles.cache.map((r) => [r.id, r.name]) ?? []);
          await safeUpdate(i, {
            embeds: [
              new EmbedBuilder()
                .setTitle("Quota Whitelist")
                .setColor(0x5865f2)
                .setDescription(
                  "Roles on this list are **completely skipped** during the Friday quota check — " +
                  "they won't receive warnings, strikes, or terminations.\n\n" +
                  "Use the role picker to add roles, or the dropdown to remove them.",
                )
                .addFields({
                  name: "Currently Whitelisted",
                  value: (cfg.quotaWhitelistRoles ?? []).length > 0
                    ? (cfg.quotaWhitelistRoles ?? []).map((r) => `<@&${r}>`).join(", ")
                    : "*None*",
                }),
            ],
            components: whitelistManageRows(cfg, roleNameMap),
          });
          return;
        }

        if (id === "cfg:quotaWhitelistAdd" && i.isRoleSelectMenu()) {
          const toAdd = Array.from(i.values);
          cfg = await updateGuildConfig(guildId, (c) => {
            const current = new Set(c.quotaWhitelistRoles ?? []);
            for (const r of toAdd) current.add(r);
            c.quotaWhitelistRoles = Array.from(current);
            return c;
          });
          const roleNameMap = new Map(i.guild?.roles.cache.map((r) => [r.id, r.name]) ?? []);
          await safeUpdate(i, {
            embeds: [
              new EmbedBuilder()
                .setTitle("Quota Whitelist")
                .setColor(0x57f287)
                .setDescription(`Added ${toAdd.map((r) => `<@&${r}>`).join(", ")} to the whitelist.`)
                .addFields({
                  name: "Currently Whitelisted",
                  value: (cfg.quotaWhitelistRoles ?? []).length > 0
                    ? (cfg.quotaWhitelistRoles ?? []).map((r) => `<@&${r}>`).join(", ")
                    : "*None*",
                }),
            ],
            components: whitelistManageRows(cfg, roleNameMap),
          });
          return;
        }

        if (id === "cfg:quotaWhitelistRemove" && i.isStringSelectMenu()) {
          const toRemove = i.values[0]!;
          if (toRemove !== "_noop") {
            cfg = await updateGuildConfig(guildId, (c) => {
              c.quotaWhitelistRoles = (c.quotaWhitelistRoles ?? []).filter((r) => r !== toRemove);
              return c;
            });
          }
          const roleNameMap = new Map(i.guild?.roles.cache.map((r) => [r.id, r.name]) ?? []);
          await safeUpdate(i, {
            embeds: [
              new EmbedBuilder()
                .setTitle("Quota Whitelist")
                .setColor(0x5865f2)
                .setDescription("Role removed from the whitelist.")
                .addFields({
                  name: "Currently Whitelisted",
                  value: (cfg.quotaWhitelistRoles ?? []).length > 0
                    ? (cfg.quotaWhitelistRoles ?? []).map((r) => `<@&${r}>`).join(", ")
                    : "*None*",
                }),
            ],
            components: whitelistManageRows(cfg, roleNameMap),
          });
          return;
        }

        if (id === "cfg:quotaWhitelistClearAll") {
          cfg = await updateGuildConfig(guildId, (c) => {
            c.quotaWhitelistRoles = [];
            return c;
          });
          const roleNameMap = new Map(i.guild?.roles.cache.map((r) => [r.id, r.name]) ?? []);
          await safeUpdate(i, {
            embeds: [
              new EmbedBuilder()
                .setTitle("Quota Whitelist")
                .setColor(0xed4245)
                .setDescription("Whitelist cleared. All staff roles will now be checked on Fridays."),
            ],
            components: whitelistManageRows(cfg, roleNameMap),
          });
          return;
        }

        if (id === "cfg:quotaFailurePunishments") {
          cfg = await getGuildConfig(guildId);
          const modal = buildSettingsModal(cfg, "quotaFailure");
          if (!modal) return;
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({
              filter: (s) => s.customId === "cfg:quotaFailureModalResult" && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
            const validActions = new Set<FailureAction>(["none", "warning", "strike", "demotion", "termination"]);
            const toAction = (raw: string): FailureAction => {
              const trimmed = raw.trim().toLowerCase() as FailureAction;
              return validActions.has(trimmed) ? trimmed : "none";
            };
            cfg = await updateGuildConfig(guildId, (c) => {
              c.quotaFailureConfig = {
                failure1:    toAction(submit.fields.getTextInputValue("failure1")),
                failure2:    toAction(submit.fields.getTextInputValue("failure2")),
                failure3plus: toAction(submit.fields.getTextInputValue("failure3plus")),
              };
              return c;
            });
            if (submit.isFromMessage()) {
              await safeSubmitUpdate(submit, { embeds: [buildQuotaEmbed(cfg)], components: quotaRows(cfg) });
            } else {
              await submit.reply({ content: "Quota failure punishments saved.", flags: 1 << 6 });
            }
          } catch {
            // timed out or dismissed
          }
          return;
        }

        if (id === "cfg:quotaRoleTarget") {
          await safeUpdate(i, {
            embeds: [
              buildQuotaEmbed(cfg).setDescription(
                "Select a role to set its specific quota target.\n" +
                "This overrides the global target for members of that role.",
              ),
            ],
            components: roleQuotaPickRows(),
          });
          return;
        }

        if (id === "cfg:quotaRoleSelect" && i.isRoleSelectMenu()) {
          const roleId = i.values[0]!;
          const role = i.guild?.roles.cache.get(roleId);
          if (!role) return;
          const existing = cfg.roleQuotas?.[roleId];
          await i.showModal(roleQuotaModal(role, existing));
          try {
            const submit = await i.awaitModalSubmit({
              filter: (s) => s.customId === `cfg:quotaRoleModal:${roleId}` && s.user.id === i.user.id,
              time: 5 * 60 * 1000,
            });
            const messages = parseInt(submit.fields.getTextInputValue("messages"), 10);
            const modActions = parseInt(submit.fields.getTextInputValue("modActions"), 10);
            if (!Number.isFinite(messages) || messages < 0 || !Number.isFinite(modActions) || modActions < 0) {
              await submit.reply({ content: "Both values must be non-negative integers.", flags: 1 << 6 });
              return;
            }
            cfg = await updateGuildConfig(guildId, (c) => {
              if (!c.roleQuotas) c.roleQuotas = {};
              c.roleQuotas[roleId] = { messages, modActions };
              return c;
            });
            if (submit.isFromMessage()) {
              await safeSubmitUpdate(submit, { embeds: [buildQuotaEmbed(cfg)], components: quotaRows(cfg) });
            } else {
              await submit.reply({
                content: `Set quota for <@&${roleId}>: **${messages}** msgs / **${modActions}** mod actions per week.`,
                flags: 1 << 6,
              });
            }
          } catch {
            // timed out or dismissed
          }
          return;
        }

        if (id === "cfg:quotaDaySet" && i.isStringSelectMenu()) {
          const day = Number(i.values[0]);
          if (Number.isFinite(day) && day >= 0 && day <= 6) {
            cfg = await updateGuildConfig(guildId, (c) => {
              if (!c.quotaConfig) {
                c.quotaConfig = { messages: 50, modActions: 5, weekStartDay: day };
              } else {
                c.quotaConfig.weekStartDay = day;
              }
              return c;
            });
          }
          await safeUpdate(i, { embeds: [buildQuotaEmbed(cfg)], components: quotaRows(cfg) });
          return;
        }


        // ── Levels handlers ──────────────────────────────────────────────────

        if (id === "cfg:levels:toggle") {
          const lc = await updateLevelConfig(guildId, (c) => ({ ...c, enabled: !c.enabled }));
          await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          return;
        }

        if (id === "cfg:levels:toggleStackRoles") {
          const lc = await updateLevelConfig(guildId, (c) => ({ ...c, stackRoles: !c.stackRoles }));
          await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          return;
        }

        if (id === "cfg:levels:toggleAnnounce") {
          const lc = await updateLevelConfig(guildId, (c) => ({ ...c, levelUpAnnounce: !c.levelUpAnnounce }));
          await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          return;
        }

        if (id === "cfg:levels:setLevelUpChannel") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("Select the channel where level-up announcements go. Pick the same channel members chat in, or a dedicated #level-up channel.")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("cfg:levels:levelUpChResult").setChannelTypes(ChannelType.GuildText).setPlaceholder("Select level-up channel"),
              ),
              backRow(),
            ],
          });
          return;
        }

        if (id === "cfg:levels:levelUpChResult" && i.isChannelSelectMenu()) {
          const lc = await updateLevelConfig(guildId, (c) => ({ ...c, levelUpChannel: i.values[0] ?? null }));
          await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          return;
        }

        if (id === "cfg:levels:setIgnoredChannels") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("Select channels where members will **not** earn XP.")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("cfg:levels:ignoredChResult").setChannelTypes(ChannelType.GuildText).setPlaceholder("Select ignored channels").setMinValues(0).setMaxValues(25),
              ),
              backRow(),
            ],
          });
          return;
        }

        if (id === "cfg:levels:ignoredChResult" && i.isChannelSelectMenu()) {
          const lc = await updateLevelConfig(guildId, (c) => ({ ...c, ignoredChannels: i.values }));
          await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          return;
        }

        if (id === "cfg:levels:setAllowedChannels") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("Select channels where members **can** earn XP (leave empty to allow all channels).")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("cfg:levels:allowedChResult").setChannelTypes(ChannelType.GuildText).setPlaceholder("Select allowed channels (empty = all)").setMinValues(0).setMaxValues(25),
              ),
              backRow(),
            ],
          });
          return;
        }

        if (id === "cfg:levels:allowedChResult" && i.isChannelSelectMenu()) {
          const lc = await updateLevelConfig(guildId, (c) => ({ ...c, allowedChannels: i.values }));
          await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          return;
        }

        if (id === "cfg:levels:setIgnoredRoles") {
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("Select roles that will be **excluded** from earning XP (e.g. bots, staff).")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new RoleSelectMenuBuilder().setCustomId("cfg:levels:ignoredRolesResult").setPlaceholder("Select ignored roles").setMinValues(0).setMaxValues(25),
              ),
              backRow(),
            ],
          });
          return;
        }

        if (id === "cfg:levels:ignoredRolesResult" && i.isRoleSelectMenu()) {
          const lc = await updateLevelConfig(guildId, (c) => ({ ...c, ignoredRoles: i.values }));
          await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          return;
        }

        if (id === "cfg:levels:setXpRates") {
          const modal = new ModalBuilder().setCustomId("cfg:levels:xpRatesModal").setTitle("XP Rates & Cooldown");
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("xpMin").setLabel("Min XP per message (1–100)").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(3),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("xpMax").setLabel("Max XP per message (1–100)").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(3),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("cooldown").setLabel("Message cooldown (seconds, 0–3600)").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(4),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("vcXp").setLabel("XP per VC minute (0 = disabled)").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(3),
            ),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:levels:xpRatesModal" });
            const xpMin = Math.min(100, Math.max(1, parseInt(submit.fields.getTextInputValue("xpMin")) || 15));
            const xpMax = Math.min(100, Math.max(xpMin, parseInt(submit.fields.getTextInputValue("xpMax")) || 25));
            const cooldown = Math.min(3600, Math.max(0, parseInt(submit.fields.getTextInputValue("cooldown")) || 60));
            const vcXp = Math.min(100, Math.max(0, parseInt(submit.fields.getTextInputValue("vcXp")) || 5));
            const lc = await updateLevelConfig(guildId, (c) => ({ ...c, xpPerMessageMin: xpMin, xpPerMessageMax: xpMax, xpCooldownSeconds: cooldown, xpPerVcMinute: vcXp }));
            await submit.reply({ content: `${CE.success.str} XP rates updated.`, flags: 1 << 6 });
            await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          } catch { /* timed out */ }
          return;
        }

        if (id === "cfg:levels:setLevelLimit") {
          const modal = new ModalBuilder().setCustomId("cfg:levels:levelLimitModal").setTitle("Level Limit");
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("limit").setLabel("Max level (0 = no limit)").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(5),
            ),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:levels:levelLimitModal" });
            const val = parseInt(submit.fields.getTextInputValue("limit")) || 0;
            const lc = await updateLevelConfig(guildId, (c) => ({ ...c, levelLimit: val <= 0 ? null : val }));
            await submit.reply({ content: `${CE.success.str} Level limit ${val <= 0 ? "removed" : `set to ${val}`}.`, flags: 1 << 6 });
            await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          } catch { /* timed out */ }
          return;
        }

        if (id === "cfg:levels:editMessage") {
          const curLc = await getLevelConfig(guildId);
          const modal = new ModalBuilder().setCustomId("cfg:levels:editMessageModal").setTitle("Level-Up Message");
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("msg").setLabel("Message ({user} and {level} as placeholders)").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(200).setValue(curLc.embedMessage),
            ),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:levels:editMessageModal" });
            const msg = submit.fields.getTextInputValue("msg").slice(0, 200);
            const lc = await updateLevelConfig(guildId, (c) => ({ ...c, embedMessage: msg }));
            await submit.reply({ content: `${CE.success.str} Level-up message updated.`, flags: 1 << 6 });
            await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          } catch { /* timed out */ }
          return;
        }

        if (id === "cfg:levels:setEmbedColor") {
          const modal = new ModalBuilder().setCustomId("cfg:levels:colorModal").setTitle("Embed Color");
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("color").setLabel("Hex color (e.g. #5865F2)").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(4).setMaxLength(7),
            ),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:levels:colorModal" });
            const hex = submit.fields.getTextInputValue("color").replace("#", "");
            const color = parseInt(hex, 16);
            if (isNaN(color)) { await submit.reply({ content: `${CE.error.str} Invalid hex color.`, flags: 1 << 6 }); return; }
            const lc = await updateLevelConfig(guildId, (c) => ({ ...c, embedColor: color }));
            await submit.reply({ content: `${CE.success.str} Embed color updated.`, flags: 1 << 6 });
            await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          } catch { /* timed out */ }
          return;
        }

        if (id === "cfg:levels:addLevelRole") {
          const modal = new ModalBuilder().setCustomId("cfg:levels:addRoleLevelModal").setTitle("Add Level Role");
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("level").setLabel("Level required (1–500)").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(3),
            ),
          );
          await i.showModal(modal);
          try {
            const submit = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === "cfg:levels:addRoleLevelModal" });
            const levelNum = Math.max(1, parseInt(submit.fields.getTextInputValue("level")) || 1);
            await submit.reply({
              content: `${CE.loading.str} Now select the role to assign at **Level ${levelNum}**:`,
              flags: 1 << 6,
              components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new RoleSelectMenuBuilder().setCustomId(`cfg:levels:addRoleSelect:${levelNum}`).setPlaceholder(`Role for Level ${levelNum}`),
              )],
            });
          } catch { /* timed out */ }
          return;
        }

        if (id.startsWith("cfg:levels:addRoleSelect:") && i.isRoleSelectMenu()) {
          const levelNum = parseInt(id.split(":")[4] ?? "1") || 1;
          const roleId = i.values[0];
          if (!roleId) return;
          const lc = await updateLevelConfig(guildId, (c) => {
            const roles = c.levelRoles.filter((r) => r.level !== levelNum);
            roles.push({ level: levelNum, roleId });
            return { ...c, levelRoles: roles.sort((a, b) => a.level - b.level) };
          });
          await i.update({ content: `${CE.success.str} Role <@&${roleId}> will be given at Level **${levelNum}**.`, components: [] });
          await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          return;
        }

        if (id === "cfg:levels:removeLevelRole") {
          const curLc = await getLevelConfig(guildId);
          if (curLc.levelRoles.length === 0) {
            await i.reply({ content: `${CE.error.str} No level roles configured.`, flags: 1 << 6 });
            return;
          }
          const options = curLc.levelRoles.slice(0, 25).map((r) => ({
            label: `Level ${r.level}`,
            value: `${r.level}:${r.roleId}`,
            description: `Role ID: ${r.roleId}`,
          }));
          await safeUpdate(i, {
            embeds: [new EmbedBuilder().setColor(0xed4245).setDescription("Select a level role to remove:")],
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new StringSelectMenuBuilder().setCustomId("cfg:levels:removeLevelRoleResult").setPlaceholder("Select level role").addOptions(options),
              ),
              backRow(),
            ],
          });
          return;
        }

        if (id === "cfg:levels:removeLevelRoleResult" && i.isStringSelectMenu()) {
          const [levelStr, roleId] = i.values[0]!.split(":");
          const levelNum = parseInt(levelStr ?? "0");
          const lc = await updateLevelConfig(guildId, (c) => ({ ...c, levelRoles: c.levelRoles.filter((r) => !(r.level === levelNum && r.roleId === roleId)) }));
          await safeUpdate(i, { embeds: [buildLevelsEmbed(lc)], components: levelsRows(lc) });
          return;
        }

        // ── Staff role management ───────────────────────────────────────────

        if (id === "cfg:staffRoleAdd" && i.isRoleSelectMenu()) {
          const roleId = i.values[0];
          if (roleId) await addStaffRole(guildId, roleId).catch(() => {});
          const view = await staffRolesView(guildId);
          await safeUpdate(i, { embeds: [view.embed], components: view.rows });
          return;
        }

        if (id === "cfg:staffRoleRemove" && i.isStringSelectMenu()) {
          const roleId = i.values[0];
          if (roleId && roleId !== "_noop") await removeStaffRole(guildId, roleId).catch(() => {});
          const view = await staffRolesView(guildId);
          await safeUpdate(i, { embeds: [view.embed], components: view.rows });
          return;
        }
      } catch (err: unknown) {
        logger.error({ err }, "config collector error");
        if (!i.replied && !i.deferred) {
          await i.reply({ content: "Something went wrong.", flags: 1 << 6 }).catch(() => {});
        }
      }
    });

    collector.on("end", async (_collected, reason) => {
      if (reason === "closed") return;
      try {
        await interaction.editReply({ components: [] });
      } catch {
        // swallow
      }
    });
  },
};

export default command;
