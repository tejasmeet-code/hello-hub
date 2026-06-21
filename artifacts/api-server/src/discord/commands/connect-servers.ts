import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";
import { isAdminOrOwner } from "../utils/staffPerms";
import { PERM_WHITELIST } from "../storage/whitelist";
import {
  approvePending,
  createPending,
  disconnectGuild,
  findPendingByGuilds,
  getConnectedGuildId,
  rejectPending,
} from "../storage/connections";
import { logger } from "../../lib/logger";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("connect-servers")
    .setDescription("Link this server to another (staff ↔ main).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("init")
        .setDescription("Send a connection request to another server.")
        .addStringOption((o) =>
          o
            .setName("kind")
            .setDescription("This server's role in the connection")
            .setRequired(true)
            .addChoices(
              { name: "Staff server", value: "staff" },
              { name: "Main server", value: "main" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("guild-id")
            .setDescription("The other server's ID")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("accept")
        .setDescription("Accept a pending connection from another server.")
        .addStringOption((o) =>
          o
            .setName("guild-id")
            .setDescription("The requesting server's ID")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("Show this server's current connection."),
    )
    .addSubcommand((s) =>
      s.setName("disconnect").setDescription("Remove the active connection."),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "Run this in a server.", ephemeral: true });
      return;
    }
    if (
      !isAdminOrOwner(interaction) &&
      !PERM_WHITELIST.has(interaction.user.id)
    ) {
      await interaction.reply({
        content: "Only administrators can manage connections.",
        ephemeral: true,
      });
      return;
    }
    const sub = interaction.options.getSubcommand(true);

    if (sub === "init") {
      const kind = interaction.options.getString("kind", true) as
        | "staff"
        | "main";
      const otherId = interaction.options.getString("guild-id", true).trim();
      if (otherId === interaction.guildId) {
        await interaction.reply({
          content: "You can't connect a server to itself.",
          ephemeral: true,
        });
        return;
      }
      if (!/^\d{15,25}$/.test(otherId)) {
        await interaction.reply({
          content: "That doesn't look like a valid Discord server ID.",
          ephemeral: true,
        });
        return;
      }
      const existing = await getConnectedGuildId(interaction.guildId);
      if (existing) {
        await interaction.reply({
          content: `Already connected to \`${existing.otherGuildId}\`. Disconnect first.`,
          ephemeral: true,
        });
        return;
      }
      // Make sure the bot can see the other guild.
      const otherGuild = await interaction.client.guilds
        .fetch(otherId)
        .catch(() => null);
      if (!otherGuild) {
        await interaction.reply({
          content:
            "I can't see that server. Make sure I'm a member of it before sending a connection request.",
          ephemeral: true,
        });
        return;
      }
      await createPending(interaction.guildId, otherId, kind, interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle(`${CE.link_icon.str} Connection request sent`)
        .setColor(0x5865f2)
        .setDescription(
          `Have an admin/owner of **${otherGuild.name}** (\`${otherId}\`) run:\n` +
            `\`\`\`\n/connect-servers accept guild-id:${interaction.guildId}\n\`\`\`\n` +
            `This server's declared role: **${kind}**.`,
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "accept") {
      const otherId = interaction.options.getString("guild-id", true).trim();
      if (otherId === interaction.guildId) {
        await interaction.reply({
          content: "You can't accept a request from this same server.",
          ephemeral: true,
        });
        return;
      }
      const existing = await getConnectedGuildId(interaction.guildId);
      if (existing) {
        await interaction.reply({
          content: `Already connected to \`${existing.otherGuildId}\`. Disconnect first.`,
          ephemeral: true,
        });
        return;
      }
      const pending = await findPendingByGuilds(interaction.guildId, otherId);
      if (!pending) {
        await interaction.reply({
          content: `No pending connection between this server and \`${otherId}\`.`,
          ephemeral: true,
        });
        return;
      }
      // Sanity: we expect the request to come *from* otherId.
      if (pending.fromGuildId !== otherId) {
        await interaction.reply({
          content:
            "This server has its own outbound request to that server. Have them accept it instead.",
          ephemeral: true,
        });
        return;
      }

      const otherGuild = await interaction.client.guilds
        .fetch(otherId)
        .catch(() => null);
      const embed = new EmbedBuilder()
        .setTitle(`${CE.link_icon.str} Connection request`)
        .setColor(0xfaa61a)
        .setDescription(
          `**${otherGuild?.name ?? otherId}** (\`${otherId}\`) wants to link with this server.\n` +
            `Their declared role: **${pending.declaredFromRole}**.\n` +
            `This server will be the **${pending.declaredFromRole === "staff" ? "main" : "staff"}** side.`,
        );
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`connect:approve:${pending.id}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`connect:reject:${pending.id}`)
          .setLabel("Reject")
          .setStyle(ButtonStyle.Danger),
      );
      const reply = await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: false,
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000,
      });
      collector.on("collect", async (btn: ButtonInteraction) => {
        const allowed =
          PERM_WHITELIST.has(btn.user.id) ||
          interaction.guild?.ownerId === btn.user.id ||
          (btn.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
            false);
        if (!allowed) {
          await btn.reply({
            content:
              "Only an admin/owner of this server (or someone on the global whitelist) can approve.",
            ephemeral: true,
          });
          return;
        }
        if (btn.customId === `connect:reject:${pending.id}`) {
          await rejectPending(pending.id);
          collector.stop("rejected");
          await btn.update({
            content: "❌ Connection request rejected.",
            embeds: [],
            components: [],
          });
          return;
        }
        try {
          const conn = await approvePending(pending.id, btn.user.id);
          collector.stop("approved");
          if (!conn) {
            await btn.update({
              content: "Couldn't approve — request not found.",
              embeds: [],
              components: [],
            });
            return;
          }
          await btn.update({
            content: `✅ Connected. \`${conn.guildAId}\` (${conn.guildARole}) ↔ \`${conn.guildBId}\` (${conn.guildBRole}).`,
            embeds: [],
            components: [],
          });
        } catch (err) {
          logger.warn({ err }, "approvePending failed");
          await btn.reply({
            content: "Couldn't complete the connection.",
            ephemeral: true,
          });
        }
      });
      collector.on("end", async (_c, reason) => {
        if (reason === "approved" || reason === "rejected") return;
        await reply
          .edit({
            content: "⌛ Connection request timed out.",
            embeds: [],
            components: [],
          })
          .catch(() => {});
      });
      return;
    }

    if (sub === "status") {
      const conn = await getConnectedGuildId(interaction.guildId);
      if (!conn) {
        await interaction.reply({
          content: "This server isn't connected to any other server.",
          ephemeral: true,
        });
        return;
      }
      const otherGuild = await interaction.client.guilds
        .fetch(conn.otherGuildId)
        .catch(() => null);
      await interaction.reply(
        `${CE.link_icon.str} Connected to **${otherGuild?.name ?? conn.otherGuildId}** (\`${conn.otherGuildId}\`).\n` +
          `This server is the **${conn.role}** side.`,
      );
      return;
    }

    if (sub === "disconnect") {
      const link = await getConnectedGuildId(interaction.guildId);
      const ok = link ? await disconnectGuild(interaction.guildId, link.otherGuildId) : false;
      if (!ok) {
        await interaction.reply({
          content: "No active connection.",
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(`🗑️ Disconnected.`);
      return;
    }
  },
};

export default command;
