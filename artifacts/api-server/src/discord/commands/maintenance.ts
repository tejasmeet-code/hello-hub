import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type Role,
  type GuildChannel,
  type Guild,
} from "discord.js";
import type { SlashCommand } from "../types";
import {
  getGuildConfig,
  updateGuildConfig,
  type MaintenanceModuleConfig,
  type ChannelPermSnap,
} from "../storage/config";
import { isManager } from "../utils/staffPerms";
import { prettyEmbed, COLORS, CE } from "../utils/embedStyle";
import { logger } from "../../lib/logger";

export function makeMaintenancePanel(active: boolean): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle(`${CE.settings.str} Server Maintenance Control Panel`)
    .setDescription(
      active
        ? `**Status:** ${CE.failure.str} Maintenance is currently **ACTIVE**\n\nRegular members can only see the maintenance category. Click **End Maintenance** to restore access.`
        : `**Status:** ${CE.success.str} Server is **ONLINE**\n\nClick **Start Maintenance** to restrict member access to the maintenance category only.`,
    )
    .setColor(active ? 0xe74c3c : 0x2ecc71)
    .setFooter({ text: "Only server managers can trigger maintenance." })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("maintenance:start")
      .setLabel("Start Maintenance")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(active),
    new ButtonBuilder()
      .setCustomId("maintenance:end")
      .setLabel("End Maintenance")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!active),
  );

  return { embeds: [embed], components: [row] };
}

const PERM_BATCH = 5;
const PERM_BATCH_DELAY_MS = 400;

async function runBatched(tasks: (() => Promise<void>)[]): Promise<void> {
  for (let i = 0; i < tasks.length; i += PERM_BATCH) {
    await Promise.allSettled(tasks.slice(i, i + PERM_BATCH).map((fn) => fn()));
    if (i + PERM_BATCH < tasks.length) {
      await new Promise((r) => setTimeout(r, PERM_BATCH_DELAY_MS));
    }
  }
}

export async function handleMaintenanceButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction
      .reply({ content: "This can only be used in a server.", flags: 1 << 6 })
      .catch(() => {});
    return;
  }

  if (!(await isManager(interaction as unknown as ChatInputCommandInteraction))) {
    await interaction
      .reply({ content: "Only server managers can trigger maintenance.", flags: 1 << 6 })
      .catch(() => {});
    return;
  }

  const isStart = interaction.customId === "maintenance:start";
  await interaction.deferReply({ flags: 1 << 6 });

  const cfg = await getGuildConfig(interaction.guildId);
  const mc: MaintenanceModuleConfig | undefined = cfg.maintenanceConfig;

  if (!mc?.membersRoleId) {
    await interaction.editReply({
      content:
        "Maintenance is not fully configured. Run `/maintenance setup` then `/maintenance set-members-role` first.",
    });
    return;
  }

  const guild = interaction.guild;
  const membersRoleId = mc.membersRoleId;

  if (isStart) {
    // ── 1. Ensure the maintenance category allows the members role ──────────
    if (mc.categoryId) {
      const cat =
        guild.channels.cache.get(mc.categoryId) ??
        (await guild.channels.fetch(mc.categoryId).catch(() => null));
      if (cat) {
        await (cat as GuildChannel).permissionOverwrites
          .edit(
            membersRoleId,
            { ViewChannel: true, SendMessages: true, ReadMessageHistory: true },
            { reason: "Maintenance started: open maintenance area for members" },
          )
          .catch((e) => logger.warn({ e }, "Maintenance: failed to open category"));
      }
    }

    // ── 2. Snapshot + lock all channels outside the maintenance category ────
    const allChannels = await guild.channels.fetch();
    const savedPerms: Record<string, ChannelPermSnap> = {};
    const toProcess: (() => Promise<void>)[] = [];

    for (const [chId, channel] of allChannels) {
      if (!channel) continue;
      // Skip the maintenance category itself
      if (chId === mc.categoryId) continue;
      // Skip children of the maintenance category (they inherit the allow)
      if ((channel as any).parentId === mc.categoryId) continue;

      const existing = (channel as GuildChannel).permissionOverwrites?.cache.get(membersRoleId);
      const hadDeny = existing?.deny.has(PermissionFlagsBits.ViewChannel) ?? false;
      savedPerms[chId] = { viewDenyBefore: hadDeny };

      if (!hadDeny) {
        toProcess.push(async () => {
          await (channel as GuildChannel).permissionOverwrites
            .edit(membersRoleId, { ViewChannel: false }, { reason: "Maintenance started" })
            .catch((e) => logger.warn({ e, chId }, "Maintenance: failed to deny channel"));
        });
      }
    }

    await runBatched(toProcess);

    await updateGuildConfig(interaction.guildId, (c) => ({
      ...c,
      maintenanceConfig: { ...c.maintenanceConfig, active: true, savedPerms },
    }));

    // ── 3. Announce ──────────────────────────────────────────────────────────
    if (mc.announcementsChannelId) {
      const announceCh =
        guild.channels.cache.get(mc.announcementsChannelId) ??
        (await guild.channels.fetch(mc.announcementsChannelId).catch(() => null));
      if (announceCh?.isTextBased()) {
        const mode = mc.announceMode ?? "embed";
        const defaultText =
          "The server is currently undergoing maintenance. Members can only access the maintenance area.\n\nThank you for your patience!";
        const textContent = mc.announceText || defaultText;
        const embedTitle = mc.announceEmbedTitle || `${CE.settings.str} Server Maintenance Has Started`;
        const embedDesc = mc.announceEmbedDescription || textContent;

        const payload: any = {};
        if (mode === "text") {
          payload.content = textContent;
        } else if (mode === "embed") {
          payload.embeds = [
            new EmbedBuilder()
              .setTitle(embedTitle)
              .setDescription(embedDesc)
              .setColor(0xe74c3c)
              .setTimestamp(),
          ];
        } else {
          // embed_text
          payload.content = textContent;
          payload.embeds = [
            new EmbedBuilder()
              .setTitle(embedTitle)
              .setDescription(embedDesc)
              .setColor(0xe74c3c)
              .setTimestamp(),
          ];
        }
        await announceCh.send(payload).catch((err) =>
          logger.warn({ err, chId: mc.announcementsChannelId }, "Failed to send start announcement"),
        );
      }
    }

    await interaction.editReply({
      content: `${CE.settings.str} Maintenance started. Locked **${toProcess.length}** channel(s). Members can only see the maintenance category.`,
    });
  } else {
    // ── End maintenance: restore channel permissions ─────────────────────────
    const savedPerms = mc.savedPerms ?? {};
    const allChannels = await guild.channels.fetch();
    const toRestore: (() => Promise<void>)[] = [];

    for (const [chId, snap] of Object.entries(savedPerms)) {
      // If the channel already had a ViewChannel deny before we started → don't touch it
      if (snap?.viewDenyBefore) continue;
      const channel = allChannels.get(chId);
      if (!channel) continue;

      toRestore.push(async () => {
        await (channel as GuildChannel).permissionOverwrites
          .edit(
            membersRoleId,
            { ViewChannel: null },
            { reason: "Maintenance ended" },
          )
          .catch((e) => logger.warn({ e, chId }, "Maintenance: failed to restore channel"));
      });
    }

    await runBatched(toRestore);

    await updateGuildConfig(interaction.guildId, (c) => ({
      ...c,
      maintenanceConfig: { ...c.maintenanceConfig, active: false, savedPerms: undefined },
    }));

    // ── Announce ─────────────────────────────────────────────────────────────
    if (mc.announcementsChannelId) {
      const announceCh =
        guild.channels.cache.get(mc.announcementsChannelId) ??
        (await guild.channels.fetch(mc.announcementsChannelId).catch(() => null));
      if (announceCh?.isTextBased()) {
        await announceCh
          .send({
            embeds: [
              new EmbedBuilder()
                .setTitle(`${CE.success.str} Server Maintenance Has Ended`)
                .setDescription(
                  "Maintenance is complete. All channel permissions have been restored.\n\nWelcome back!",
                )
                .setColor(0x2ecc71)
                .setTimestamp(),
            ],
          })
          .catch(() => {});
      }
    }

    await interaction.editReply({
      content: `${CE.success.str} Maintenance ended. Restored permissions for **${toRestore.length}** channel(s).`,
    });
  }

  try {
    await interaction.message.edit(makeMaintenancePanel(isStart));
  } catch {}
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("maintenance")
    .setDescription("Manage server maintenance mode")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Create the maintenance category and channels")
        .addRoleOption((o) =>
          o
            .setName("members-role")
            .setDescription(
              "The members role whose channel view permissions will be locked during maintenance",
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("set-members-role")
        .setDescription("Update the members role used during maintenance")
        .addRoleOption((o) =>
          o
            .setName("role")
            .setDescription("The role to lock during maintenance")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("set-message")
        .setDescription("Customize the announcement message posted when maintenance starts")
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("Message format: embed, text, or embed+text")
            .setRequired(true)
            .addChoices(
              { name: "Embed Only", value: "embed" },
              { name: "Text Only", value: "text" },
              { name: "Embed + Text", value: "embed_text" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("text")
            .setDescription("Custom text or embed description")
            .setRequired(false)
            .setMaxLength(1500),
        )
        .addStringOption((o) =>
          o
            .setName("title")
            .setDescription("Custom embed title (for embed modes)")
            .setRequired(false)
            .setMaxLength(250),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("panel")
        .setDescription("Post the maintenance control panel with Start/End buttons"),
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Check current maintenance status"),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "This command must be used in a server.",
        flags: 1 << 6,
      });
      return;
    }

    if (!(await isManager(interaction))) {
      await interaction.reply({
        content: "Only server managers can use this command.",
        flags: 1 << 6,
      });
      return;
    }

    const cfg = await getGuildConfig(interaction.guildId);

    if (!cfg.modules.serverMaintenance) {
      await interaction.reply({
        content:
          "The **Server Maintenance** module is disabled. Enable it in `/config` first.",
        flags: 1 << 6,
      });
      return;
    }

    const sub = interaction.options.getSubcommand(true);

    // ── setup ────────────────────────────────────────────────────────────────
    if (sub === "setup") {
      await interaction.deferReply({ flags: 1 << 6 });

      const membersRole = interaction.options.getRole("members-role") as Role | null;
      const guild = interaction.guild;

      const categoryOverwrites: {
        id: string;
        deny?: bigint[];
        allow?: bigint[];
      }[] = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      ];
      if (membersRole) {
        categoryOverwrites.push({
          id: membersRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        });
      }

      let category;
      try {
        category = await guild.channels.create({
          name: "MAINTENANCE",
          type: ChannelType.GuildCategory,
          permissionOverwrites: categoryOverwrites,
          reason: "Server Maintenance module setup",
        });
      } catch (err) {
        logger.error({ err }, "Maintenance setup: failed to create category");
        await interaction.editReply({
          content: `${CE.error.str} Failed to create the maintenance category. Please ensure I have **Manage Channels** permission.`,
        });
        return;
      }

      const channelDefs = [
        { key: "announcements", name: "announcements", topic: "Maintenance announcements" },
        { key: "chat", name: "chat", topic: "General chat during maintenance" },
        { key: "media", name: "media", topic: "Media sharing" },
        { key: "cmds", name: "cmds", topic: "Bot commands" },
      ] as const;

      const channelIds: Record<string, string> = {};
      for (const def of channelDefs) {
        try {
          const ch = await guild.channels.create({
            name: def.name,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: def.topic,
            reason: "Server Maintenance module setup",
          });
          channelIds[def.key] = ch.id;
        } catch (err) {
          logger.warn({ err, name: def.name }, "Maintenance setup: failed to create channel");
        }
      }

      await updateGuildConfig(interaction.guildId, (c) => ({
        ...c,
        maintenanceConfig: {
          ...c.maintenanceConfig,
          categoryId: category!.id,
          announcementsChannelId: channelIds["announcements"],
          chatChannelId: channelIds["chat"],
          mediaChannelId: channelIds["media"],
          cmdsChannelId: channelIds["cmds"],
          membersRoleId: membersRole?.id ?? c.maintenanceConfig?.membersRoleId,
          active: false,
        },
      }));

      const lines = [
        `${CE.folder.str} **Category:** <#${category.id}>`,
        channelIds["announcements"]
          ? `${CE.notifications.str} **Announcements:** <#${channelIds["announcements"]}>`
          : `${CE.warning.str} Announcements channel failed`,
        channelIds["chat"] ? `${CE.information.str} **Chat:** <#${channelIds["chat"]}>` : null,
        channelIds["media"] ? `${CE.media.str} **Media:** <#${channelIds["media"]}>` : null,
        channelIds["cmds"] ? `${CE.settings.str} **Cmds:** <#${channelIds["cmds"]}>` : null,
        membersRole
          ? `${CE.members.str} **Members Role:** <@&${membersRole.id}> *(view permissions locked during maintenance)*`
          : `${CE.warning.str} No members role set — run \`/maintenance set-members-role\` to configure`,
      ]
        .filter(Boolean)
        .join("\n");

      await interaction.editReply({
        embeds: [
          prettyEmbed({
            title: `${CE.settings.str} Maintenance Setup Complete`,
            description:
              lines + "\n\nRun `/maintenance panel` to post the Start/End control panel.",
            color: COLORS.success ?? 0x2ecc71,
          }),
        ],
      });
      return;
    }

    // ── set-members-role ─────────────────────────────────────────────────────
    if (sub === "set-members-role") {
      const role = interaction.options.getRole("role", true) as Role;
      const mc = cfg.maintenanceConfig;

      // Update the maintenance category's allow overwrite for the new role
      if (mc?.categoryId) {
        const guild = interaction.guild;
        const cat =
          guild.channels.cache.get(mc.categoryId) ??
          (await guild.channels.fetch(mc.categoryId).catch(() => null));
        if (cat) {
          // Remove old role's overwrite if different
          if (mc.membersRoleId && mc.membersRoleId !== role.id) {
            await (cat as GuildChannel).permissionOverwrites
              .delete(mc.membersRoleId, "Maintenance: members role changed")
              .catch(() => {});
          }
          // Add allow for new role
          await (cat as GuildChannel).permissionOverwrites
            .edit(
              role.id,
              { ViewChannel: true, SendMessages: true, ReadMessageHistory: true },
              { reason: "Maintenance: members role updated" },
            )
            .catch(() => {});
        }
      }

      await updateGuildConfig(interaction.guildId, (c) => ({
        ...c,
        maintenanceConfig: { ...c.maintenanceConfig, membersRoleId: role.id },
      }));
      await interaction.reply({
        content: `${CE.success.str} Members role updated to <@&${role.id}>.\nThis role's view permissions will be locked during maintenance and restored when it ends.`,
        flags: 1 << 6,
      });
      return;
    }

    // ── set-message ──────────────────────────────────────────────────────────
    if (sub === "set-message") {
      const mode = interaction.options.getString("mode", true) as "embed" | "text" | "embed_text";
      const text = interaction.options.getString("text") ?? undefined;
      const title = interaction.options.getString("title") ?? undefined;

      await updateGuildConfig(interaction.guildId, (c) => ({
        ...c,
        maintenanceConfig: {
          ...c.maintenanceConfig,
          announceMode: mode,
          announceText: text,
          announceEmbedTitle: title,
          announceEmbedDescription: text,
        },
      }));

      await interaction.reply({
        content: `${CE.success.str} Updated maintenance announcement format to **${mode}**.${text ? `\nCustom Text: "${text}"` : ""}`,
        flags: 1 << 6,
      });
      return;
    }

    // ── panel ────────────────────────────────────────────────────────────────
    if (sub === "panel") {
      const active = cfg.maintenanceConfig?.active ?? false;
      await interaction.reply(makeMaintenancePanel(active));
      return;
    }

    // ── status ───────────────────────────────────────────────────────────────
    if (sub === "status") {
      const mc = cfg.maintenanceConfig;
      const active = mc?.active ?? false;
      const lines = [
        `**Status:** ${active ? `${CE.failure.str} ACTIVE — maintenance is ongoing` : `${CE.success.str} Online — server is live`}`,
        "",
        mc?.categoryId ? `${CE.folder.str} **Category:** <#${mc.categoryId}>` : `${CE.folder.str} **Category:** Not set up`,
        mc?.announcementsChannelId
          ? `${CE.notifications.str} **Announcements:** <#${mc.announcementsChannelId}>`
          : `${CE.notifications.str} **Announcements:** Not set up`,
        mc?.membersRoleId
          ? `${CE.members.str} **Members Role:** <@&${mc.membersRoleId}>`
          : `${CE.members.str} **Members Role:** Not configured *(run \`/maintenance set-members-role\`)*`,
      ].join("\n");

      await interaction.reply({
        embeds: [
          prettyEmbed({
            title: `${CE.settings.str} Maintenance Status`,
            description: lines,
            color: active ? 0xe74c3c : (COLORS.success ?? 0x2ecc71),
          }),
        ],
        flags: 1 << 6,
      });
      return;
    }
  },
};

export async function autoSetupMaintenanceOnJoin(guild: Guild): Promise<void> {
  try {
    const cfg = await getGuildConfig(guild.id);
    if (cfg.maintenanceConfig?.categoryId) {
      return;
    }

    const categoryOverwrites: {
      id: string;
      deny?: bigint[];
      allow?: bigint[];
    }[] = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    ];

    const category = await guild.channels.create({
      name: "MAINTENANCE",
      type: ChannelType.GuildCategory,
      permissionOverwrites: categoryOverwrites,
      reason: "Automatic Maintenance setup upon bot joining",
    });

    const channelDefs = [
      { key: "announcements", name: "announcements", topic: "Maintenance announcements" },
      { key: "chat", name: "chat", topic: "General chat during maintenance" },
      { key: "media", name: "media", topic: "Media sharing" },
      { key: "cmds", name: "cmds", topic: "Bot commands" },
    ] as const;

    const channelIds: Record<string, string> = {};
    for (const def of channelDefs) {
      try {
        const ch = await guild.channels.create({
          name: def.name,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: def.topic,
          reason: "Automatic Maintenance setup upon bot joining",
        });
        channelIds[def.key] = ch.id;
      } catch (err) {
        logger.warn({ err, name: def.name }, "Auto maintenance setup: failed to create channel");
      }
    }

    await updateGuildConfig(guild.id, (c) => ({
      ...c,
      maintenanceConfig: {
        ...c.maintenanceConfig,
        categoryId: category.id,
        announcementsChannelId: channelIds["announcements"],
        chatChannelId: channelIds["chat"],
        mediaChannelId: channelIds["media"],
        cmdsChannelId: channelIds["cmds"],
      },
    }));
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "Failed autoSetupMaintenanceOnJoin");
  }
}

export default command;
