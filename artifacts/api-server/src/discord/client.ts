import { Client, Events, ChannelType, Partials, type GuildTextBasedChannel, type ButtonInteraction, AuditLogEvent, IntentsBitField, REST, Routes, PermissionFlagsBits } from "discord.js";
import { takeBackup, startAutoBackupScheduler } from "./storage/serverBackup";
import { cancelGuildDeletion } from "./storage/guildRetention";
import { ensureJailRole } from "./storage/jail";
import { registerGuildCommands } from "./registry/registerGuildCommands";
import { incrementGuildCount } from "./storage/guild-counter";
import { sendWebhookList, logCommandExecution } from "./utils/webhooks";
import { CE } from "./utils/embedStyle";
import { logger } from "../lib/logger";
import { getCommands, getCommandMap, getGuildCommands } from "./registry";
import { handlePrefixMessage } from "./messageHandler";
import { isServerBlacklisted } from "./storage/blacklist";
import { getGuildConfig } from "./storage/config";
import { listStaffRoles } from "./storage/staff";
import { bumpMessage } from "./storage/quota";

import { getTicketsConfig, createOpenTicket, closeOpenTicket, claimTicket, getOpenTicketsByUser, getOpenTicketByChannel, getNextTicketNumber } from "./storage/tickets";
import { getAutomodConfig, recordSpam, recordDuplicate } from "./storage/automod";
import { getActiveGiveaways, updateGiveaway } from "./storage/giveaways";
import { logDmToWebhook } from "./utils/dmWebhook";
import { initPermWhitelist } from "./storage/whitelist";

export function getDiscordClient(): Client {
  return (globalThis as any).__discordClient;
}

export async function startDiscordBot(): Promise<void> {
  await initPermWhitelist();
  const client = new Client({
    intents: [
      IntentsBitField.Flags.Guilds,
      IntentsBitField.Flags.GuildMembers,
      IntentsBitField.Flags.GuildMessages,
      IntentsBitField.Flags.MessageContent,
      IntentsBitField.Flags.GuildModeration,
      IntentsBitField.Flags.DirectMessages,
    ],
    // Partials are required so uncached DM channels still fire MessageCreate
    partials: [Partials.Channel, Partials.Message],
  });

  // Set global client reference for schedulers
  (globalThis as any).__discordClient = client;

  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN environment variable is not set");
  }
  if (!clientId) {
    throw new Error("DISCORD_CLIENT_ID environment variable is not set");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  // Only register commands within Discord's 100-command limit.
  // Fun/game commands are excluded via getGuildCommands() in registry.ts.
  const registrableCommands = getGuildCommands();
  const commandPayload = registrableCommands.map((c) => c.data.toJSON());

  startAutoBackupScheduler();
  const commandMap = getCommandMap();

  // ────────────────────────────────────────────────────────────────────
  // Once connected: register commands per-guild only (instant, no 1h delay)
  // Global registration is skipped — it hits the 100-command limit and
  // takes up to 1 hour to propagate anyway. Per-guild covers all joined
  // guilds immediately, and GuildCreate handles new servers.
  // ────────────────────────────────────────────────────────────────────
  client.once(Events.ClientReady, async (readyClient: Client<true>) => {
    logger.info({ tag: readyClient.user.tag }, "Discord bot ready");

    // ── Giveaway auto-end scheduler (check every 60s) ──────────────────────
    setInterval(async () => {
      try {
        const active = await getActiveGiveaways();
        const now = Date.now();
        for (const g of active) {
          if (g.endsAt > now) continue;
          const guild = readyClient.guilds.cache.get(g.guildId);
          if (!guild) continue;
          const channel = guild.channels.cache.get(g.channelId) as any;
          if (!channel?.messages) continue;
          const msg = await channel.messages.fetch(g.messageId).catch(() => null);
          if (!msg) {
            await updateGiveaway(g.giveawayId, (gw) => ({ ...gw, ended: true, winnerIds: [] }));
            continue;
          }
          const reaction = msg.reactions.cache.get("🎉");
          let winners: string[] = [];
          if (reaction) {
            const users = await reaction.users.fetch().catch(() => null);
            if (users) {
              let pool = [...users.values()].filter((u: any) => !u.bot);
              if (g.requiredRoleId) {
                const rm = guild.roles.cache.get(g.requiredRoleId)?.members;
                if (rm) pool = pool.filter((u: any) => rm.has(u.id));
              }
              if (g.bonusRoleId) {
                const bm = guild.roles.cache.get(g.bonusRoleId)?.members;
                const ex = g.bonusEntries ?? 2;
                if (bm) {
                  const exp: typeof pool = [];
                  for (const u of pool) { exp.push(u); if (bm.has(u.id)) for (let x = 1; x < ex; x++) exp.push(u); }
                  pool = exp;
                }
              }
              const seen = new Set<string>();
              for (const u of pool.sort(() => Math.random() - 0.5)) {
                if (seen.has(u.id)) continue;
                seen.add(u.id);
                winners.push(u.id);
                if (winners.length >= g.winnerCount) break;
              }
            }
          }
          const updated = await updateGiveaway(g.giveawayId, (gw) => ({ ...gw, ended: true, winnerIds: winners }));
          if (!updated) continue;
          const { buildGiveawayEmbed } = await import("./commands/giveaway");
          await msg.edit({ embeds: [buildGiveawayEmbed(updated)], components: [] }).catch(() => {});
          await msg.reply(winners.length > 0
            ? `🎉 Congratulations ${winners.map((id) => `<@${id}>`).join(", ")}! You won **${g.prize}**!`
            : `No valid entries — no winner for **${g.prize}**.`,
          ).catch(() => {});
        }
      } catch (err) {
        logger.warn({ err }, "Giveaway scheduler error");
      }
    }, 60_000);

    const guildIds = [...readyClient.guilds.cache.keys()];
    let guildOk = 0;
    let guildFail = 0;
    for (const guildId of guildIds) {
      try {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandPayload });
        guildOk++;
      } catch (err) {
        guildFail++;
        logger.warn({ err, guildId }, "Failed to register guild commands");
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    logger.info(
      { guildOk, guildFail, total: guildIds.length, commandCount: registrableCommands.length },
      "Guild-specific slash commands registered",
    );

  });

  client.on(Events.GuildCreate, async (guild) => {
    try {
      if (isServerBlacklisted(guild.id)) {
        logger.info({ guildId: guild.id, guildName: guild.name }, "Leaving blacklisted server");
        await guild.leave();
        return;
      }

      cancelGuildDeletion(guild.id).catch(() => {});
      await takeBackup(guild, "join");
      ensureJailRole(guild).catch(() => {});
      import("./commands/maintenance").then((m) => m.autoSetupMaintenanceOnJoin(guild)).catch(() => {});
      await registerGuildCommands(client, guild.id).catch(() => {});
      const guildNum = await incrementGuildCount();
      await new Promise((r) => setTimeout(r, 3000));
      let inviterId: string | null = null;
      try {
        const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
        const entry = logs.entries.find((e) => (e.target as { id?: string } | null)?.id === client.user?.id);
        if (entry?.executor) inviterId = entry.executor.id;
      } catch {}
      let configMention = "`/config`";
      try {
        const cmds = await guild.commands.fetch();
        const configCmd = cmds.find((c) => c.name === "config");
        if (configCmd) configMention = `</config:${configCmd.id}>`;
      } catch {}
      const serverMsg = `🎉 Thank you for adding **Relosta Bot** to your server. To get started run ${configMention}!\n◽ Guild \`#${guildNum}\``;
      const dmMsg = `🎉 Thank you for adding **Relosta Bot** to **${guild.name}**! To get started, run ${configMention} in your server.\n◽ Guild \`#${guildNum}\``;
      const fetchedChannels = await guild.channels.fetch().catch(() => null);
      const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
      let sendTarget: GuildTextBasedChannel | null = guild.systemChannel;
      if (!sendTarget && fetchedChannels && me) {
        for (const ch of fetchedChannels.values()) {
          if (ch && ch.type === ChannelType.GuildText && ch.permissionsFor(me)?.has("SendMessages")) {
            sendTarget = ch as GuildTextBasedChannel;
            break;
          }
        }
      }
      if (sendTarget) await sendTarget.send(serverMsg).catch(() => {});
      if (inviterId) {
        const inviter = await client.users.fetch(inviterId).catch(() => null);
        if (inviter) await inviter.send(dmMsg).catch(() => {});
      }
      } catch (err) {
      logger.warn({ err, guildId: guild.id }, "GuildCreate handling failed");
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Handle button and slash command interactions
  // ────────────────────────────────────────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction) => {
    if (
      (interaction.isMessageComponent() || interaction.isModalSubmit()) &&
      (interaction.customId.startsWith("staff_dir_") ||
        interaction.customId.startsWith("staff_modal_") ||
        interaction.customId.startsWith("staff_portal_"))
    ) {
      const { handlePortalInteraction } = await import("./handlers/portalHandler");
      try {
        await handlePortalInteraction(interaction);
      } catch (err) {
        logger.error({ err }, "Error handling portal interaction");
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("appeal:")) {
        const { handleAppealButton, handleAppealReviewButton } = await import("./utils/appealHandler");
        try {
          if (interaction.customId.startsWith("appeal:dm:")) {
            await handleAppealButton(interaction as ButtonInteraction);
          } else {
            await handleAppealReviewButton(interaction as ButtonInteraction);
          }
        } catch (err) {
          logger.error({ err }, "Error handling appeal button");
          await interaction.reply({ content: "There was an error handling the appeal action.", flags: 1 << 6 }).catch(() => {});
        }
      } else if (interaction.customId === "verify_prompt") {
        const { handleVerifyPromptButton } = await import("./commands/verify");
        try {
          await handleVerifyPromptButton(interaction as ButtonInteraction);
        } catch (err) {
          logger.error({ err }, "Error handling verify prompt button");
          await interaction.reply({ content: "There was an error handling the verify prompt.", flags: 1 << 6 }).catch(() => {});
        }
      } else if (interaction.customId === "verify_authorized" || interaction.customId === "verify_cancel") {
        await interaction.reply({
          content: interaction.customId === "verify_cancel"
            ? "Verification was already cancelled."
            : "This verification session has expired. Please click the verify button again to start a new session.",
          flags: 1 << 6,
        }).catch(() => {});
      } else if (interaction.customId.startsWith("partnership_")) {
        const { handlePartnershipButton } = await import("./commands/partnership");
        try {
          await handlePartnershipButton(interaction as ButtonInteraction);
        } catch (err) {
          logger.error({ err }, "Error handling partnership button");
          await interaction.reply({ content: "There was an error handling the partnership action.", flags: 1 << 6 }).catch(() => {});
        }
      } else if (interaction.customId.startsWith("maintenance:")) {
        const { handleMaintenanceButton } = await import("./commands/maintenance");
        try {
          await handleMaintenanceButton(interaction as ButtonInteraction);
        } catch (err) {
          logger.error({ err }, "Error handling maintenance button");
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "Something went wrong with maintenance.", flags: 1 << 6 }).catch(() => {});
          }
        }
      } else if (interaction.customId.startsWith("shop:")) {
        const { handleShopInteraction } = await import("./handlers/shopHandler");
        try {
          await handleShopInteraction(interaction, client);
        } catch (err) {
          logger.error({ err }, "Error handling shop button");
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "Something went wrong.", flags: 1 << 6 }).catch(() => {});
          }
        }
      } else if (interaction.customId.startsWith("banreq:")) {
        const { handleBanRequestButton } = await import("./commands/ban-request");
        try {
          await handleBanRequestButton(interaction as ButtonInteraction);
        } catch (err) {
          logger.error({ err }, "Error handling ban-request button");
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "Something went wrong.", flags: 1 << 6 }).catch(() => {});
          }
        }
      } else if (interaction.customId.startsWith("ticket:open:")) {
        // Format: ticket:open:{panelId}:{guildId}
        const parts = interaction.customId.split(":");
        const panelId = parts[2];
        const guildId = parts[3];
        if (!panelId || !guildId || !interaction.guild || !interaction.guildId) {
          await interaction.reply({ content: "Invalid ticket button.", flags: 1 << 6 }).catch(() => {}); return;
        }
        try {
          const tc = await getTicketsConfig(guildId);
          if (!tc.enabled) {
            await interaction.reply({ content: "The ticket system is currently disabled.", flags: 1 << 6 }); return;
          }
          const panel = tc.panels[panelId];
          if (!panel) {
            await interaction.reply({ content: "This ticket panel no longer exists.", flags: 1 << 6 }); return;
          }
          const existing = await getOpenTicketsByUser(guildId, interaction.user.id, panelId);
          if (existing.length > 0) {
            const ch = interaction.guild.channels.cache.get(existing[0]!.channelId);
            await interaction.reply({ content: ch ? `You already have an open ticket: ${ch}` : "You already have an open ticket.", flags: 1 << 6 }); return;
          }

          // If panel has questions, show a modal for the user to answer first
          if (panel.questions && panel.questions.length > 0) {
            const { ModalBuilder, ActionRowBuilder: MARB, TextInputBuilder, TextInputStyle } = await import("discord.js");
            const modal = new ModalBuilder()
              .setCustomId(`ticket:questions:${panelId}:${guildId}`)
              .setTitle(panel.embedTitle?.slice(0, 45) || "Open a Ticket");
            for (const [idx, q] of panel.questions.slice(0, 5).entries()) {
              modal.addComponents(
                (new MARB() as any).addComponents(
                  new TextInputBuilder()
                    .setCustomId(`q${idx}`)
                    .setLabel(q.label.slice(0, 45))
                    .setStyle(q.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
                    .setRequired(q.required),
                ),
              );
            }
            await interaction.showModal(modal);
            return;
          }

          // No questions — defer and create the ticket immediately
          await interaction.deferReply({ flags: 1 << 6 });
          const supportRoleId = panel.supportRoleId ?? tc.supportRoleId;
          const { ChannelType: CT, PermissionFlagsBits: PFB, EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = await import("discord.js");
          const num = await getNextTicketNumber(guildId, panelId);
          const ticketId = `${panel.name}-${String(num).padStart(3, "0")}`;
          const botMe = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
          if (!botMe) {
            await interaction.editReply("Could not resolve my member object — please try again."); return;
          }
          const overwrites: any[] = [
            { id: interaction.guild.id, deny: [PFB.ViewChannel] },
            { id: interaction.user.id, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ReadMessageHistory] },
            { id: botMe.id, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ManageChannels, PFB.ReadMessageHistory] },
          ];
          if (supportRoleId) overwrites.push({ id: supportRoleId, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ReadMessageHistory] });
          if (tc.adminRoleId) overwrites.push({ id: tc.adminRoleId, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ReadMessageHistory] });
          const channel = await interaction.guild.channels.create({
            name: ticketId, type: CT.GuildText, parent: panel.categoryId ?? undefined, permissionOverwrites: overwrites, reason: `Ticket by ${interaction.user.tag}`,
          });
          await createOpenTicket({ ticketId, panelId, channelId: channel.id, guildId, userId: interaction.user.id, createdAt: Date.now(), status: "open" });
          const welcomeEmbed = new EB().setTitle(`${CE.ticket.str} ${ticketId}`).setColor(panel.embedColor || 0x2b2d31)
            .setDescription(`Welcome, <@${interaction.user.id}>!\n\nSupport will be with you shortly.`)
            .setFooter({ text: "Use the buttons below to manage this ticket." }).setTimestamp();
          const ticketRow = new ARB().addComponents(
            new BB().setCustomId(`ticket:claim:${channel.id}:${guildId}`).setLabel("Claim").setStyle(BS.Primary).setEmoji("🙋"),
            new BB().setCustomId(`ticket:close:${channel.id}:${guildId}`).setLabel("Close Ticket").setStyle(BS.Danger).setEmoji({ id: CE.locked.id, name: CE.locked.name }),
          );
          const ping = supportRoleId ? `<@&${supportRoleId}>` : "";
          await channel.send({ content: `${ping} ${interaction.user}`.trim(), embeds: [welcomeEmbed], components: [ticketRow as any] });
          if (tc.logChannelId) {
            const logCh = interaction.guild.channels.cache.get(tc.logChannelId) as any;
            if (logCh?.send) await logCh.send({ embeds: [new EB().setColor(0x57f287).setTitle("Ticket Opened")
              .addFields({ name: "Ticket", value: `${channel} (\`${ticketId}\`)`, inline: true }, { name: "Opened by", value: `<@${interaction.user.id}>`, inline: true }, { name: "Panel", value: panel.name, inline: true })
              .setTimestamp()] }).catch(() => {});
          }
          await interaction.editReply(`Your ticket has been created: ${channel}`);
        } catch (err) {
          logger.error({ err }, "Error handling ticket:open button");
          if ((interaction as any).deferred || (interaction as any).replied) {
            await (interaction as any).editReply("Failed to create ticket. Check my permissions.").catch(() => {});
          } else {
            await interaction.reply({ content: "Failed to create ticket. Check my permissions.", flags: 1 << 6 }).catch(() => {});
          }
        }
      } else if (interaction.customId.startsWith("ticket:claim:")) {
        // Format: ticket:claim:{channelId}:{guildId}
        const parts = interaction.customId.split(":");
        const channelId = parts[2];
        const guildId = parts[3];
        if (!channelId || !guildId || !interaction.guild || !interaction.guildId) {
          await interaction.reply({ content: "Invalid claim button.", flags: 1 << 6 }).catch(() => {}); return;
        }
        await interaction.deferReply({ flags: 1 << 6 });
        try {
          const tc = await getTicketsConfig(guildId);
          const ticket = await getOpenTicketByChannel(guildId, channelId);
          if (!ticket) {
            await interaction.editReply("This ticket no longer exists."); return;
          }
          if (ticket.claimedBy) {
            await interaction.editReply(`This ticket is already claimed by <@${ticket.claimedBy}>.`); return;
          }
          const member = interaction.member as any;
          const hasSupportRole = tc.supportRoleId && member?.roles?.cache?.has(tc.supportRoleId);
          const hasAdminRole = tc.adminRoleId && member?.roles?.cache?.has(tc.adminRoleId);
          const isAdmin = member?.permissions?.has?.("Administrator");
          const isOwner = interaction.guild.ownerId === interaction.user.id;
          if (!hasSupportRole && !hasAdminRole && !isAdmin && !isOwner) {
            await interaction.editReply("Only support staff can claim tickets."); return;
          }

          const { PermissionFlagsBits: PFB, EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = await import("discord.js");
          const ch = interaction.guild.channels.cache.get(channelId) as any;
          if (!ch) {
            await interaction.editReply("Could not find the ticket channel."); return;
          }

          // Remove the support role's access (so only the claimer + ticket opener + admins can see it)
          if (tc.supportRoleId) {
            await ch.permissionOverwrites.edit(tc.supportRoleId, { ViewChannel: false }).catch(() => {});
          }
          // Grant the claiming staff member exclusive view access
          await ch.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          }).catch(() => {});

          // Update the ticket in storage
          await claimTicket(guildId, channelId, interaction.user.id);

          // Try to update the welcome message: disable the Claim button and show claimed label
          try {
            const messages = await ch.messages.fetch({ limit: 10 }).catch(() => null);
            if (messages) {
              const botMsg = [...messages.values()].find((m: any) => m.author?.id === interaction.client.user?.id && m.components?.length > 0);
              if (botMsg) {
                const updatedRow = new ARB().addComponents(
                  new BB().setCustomId(`ticket:claim:${channelId}:${guildId}`).setLabel(`Claimed by ${interaction.user.username}`).setStyle(BS.Primary).setEmoji("🙋").setDisabled(true),
                  new BB().setCustomId(`ticket:close:${channelId}:${guildId}`).setLabel("Close Ticket").setStyle(BS.Danger).setEmoji({ id: CE.locked.id, name: CE.locked.name }),
                );
                await (botMsg as any).edit({ components: [updatedRow] }).catch(() => {});
              }
            }
          } catch { /* non-critical */ }

          // Announce claim in-channel
          await ch.send({ embeds: [new EB().setColor(0x2b2d31).setDescription(`🙋 <@${interaction.user.id}> has **claimed** this ticket and will be handling your request.`).setTimestamp()] }).catch(() => {});

          // Log to log channel
          if (tc.logChannelId) {
            const logCh = interaction.guild.channels.cache.get(tc.logChannelId) as any;
            if (logCh?.send) await logCh.send({ embeds: [new EB().setColor(0x2b2d31).setTitle("Ticket Claimed")
              .addFields(
                { name: "Ticket", value: `${ch} (\`${ticket.ticketId}\`)`, inline: true },
                { name: "Claimed by", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Opened by", value: `<@${ticket.userId}>`, inline: true },
              ).setTimestamp()] }).catch(() => {});
          }

          await interaction.editReply(`You have claimed **${ticket.ticketId}**. Other support staff no longer have access.`);
        } catch (err) {
          logger.error({ err }, "Error handling ticket:claim button");
          await interaction.editReply("Failed to claim ticket.").catch(() => {});
        }
      } else if (interaction.customId.startsWith("ticket:close:")) {
        const parts = interaction.customId.split(":");
        const channelId = parts[2];
        const guildId = parts[3];
        if (!channelId || !guildId || !interaction.guild) {
          await interaction.reply({ content: "Invalid close button.", flags: 1 << 6 }).catch(() => {}); return;
        }
        await interaction.deferReply({ flags: 1 << 6 });
        try {
          const tc = await getTicketsConfig(guildId);
          const ticket = await getOpenTicketByChannel(guildId, channelId);
          const member = interaction.member as any;
          const isOpener = ticket?.userId === interaction.user.id;
          const hasSupportRole = tc.supportRoleId && member?.roles?.cache?.has(tc.supportRoleId);
          const hasAdminRole = tc.adminRoleId && member?.roles?.cache?.has(tc.adminRoleId);
          const isAdmin = member?.permissions?.has?.("Administrator");
          if (!isOpener && !hasSupportRole && !hasAdminRole && !isAdmin) {
            await interaction.editReply("You don't have permission to close this ticket."); return;
          }
          if (tc.transcriptChannelId && ticket) {
            const ch = interaction.guild.channels.cache.get(channelId) as any;
            if (ch) {
              const messages = await ch.messages.fetch({ limit: 100 }).catch(() => null);
              if (messages) {
                const { EmbedBuilder: EB } = await import("discord.js");
                const lines = [...messages.values()].reverse().map((m: any) => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content || "(no text)"}`);
                const tCh = interaction.guild.channels.cache.get(tc.transcriptChannelId) as any;
                if (tCh?.send) await tCh.send({ embeds: [new EB().setTitle(`${CE.transcript.str} Transcript — ${ticket.ticketId}`).setColor(0x2b2d31)
                  .addFields({ name: "Opened by", value: `<@${ticket.userId}>`, inline: true }, { name: "Closed by", value: `<@${interaction.user.id}>`, inline: true }).setTimestamp()],
                  files: [{ attachment: Buffer.from(lines.join("\n")), name: `${ticket.ticketId}.txt` }] }).catch(() => {});
              }
            }
          }
          if (tc.logChannelId && ticket) {
            const { EmbedBuilder: EB } = await import("discord.js");
            const logCh = interaction.guild.channels.cache.get(tc.logChannelId) as any;
            if (logCh?.send) await logCh.send({ embeds: [new EB().setColor(0xed4245).setTitle("Ticket Closed")
              .addFields({ name: "Ticket", value: ticket.ticketId, inline: true }, { name: "Closed by", value: `<@${interaction.user.id}>`, inline: true }).setTimestamp()] }).catch(() => {});
          }
          await closeOpenTicket(guildId, channelId);
          await interaction.editReply("Ticket closing in 5 seconds...");
          setTimeout(() => { interaction.guild?.channels.cache.get(channelId)?.delete("Ticket closed").catch(() => {}); }, 5000);
        } catch (err) {
          logger.error({ err }, "Error handling ticket:close button");
          await interaction.editReply("Failed to close ticket.").catch(() => {});
        }
      }
      return;
    }

    // Handle dropdown multi-panel selection
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ticket:multipanel:select:")) {
      const guildId = interaction.customId.split(":")[3];
      if (!guildId || !interaction.guild || !interaction.guildId) {
        await interaction.reply({ content: "Could not process selection.", flags: 1 << 6 }).catch(() => {}); return;
      }
      const panelId = interaction.values[0];
      if (!panelId) { await interaction.reply({ content: "No panel selected.", flags: 1 << 6 }); return; }
      try {
        const tc = await getTicketsConfig(guildId);
        if (!tc.enabled) { await interaction.reply({ content: "The ticket system is currently disabled.", flags: 1 << 6 }); return; }
        const panel = tc.panels[panelId];
        if (!panel) { await interaction.reply({ content: "That ticket panel no longer exists.", flags: 1 << 6 }); return; }
        const existing = await getOpenTicketsByUser(guildId, interaction.user.id, panelId);
        if (existing.length > 0) {
          const ch = interaction.guild.channels.cache.get(existing[0]!.channelId);
          await interaction.reply({ content: ch ? `You already have an open ticket: ${ch}` : "You already have an open ticket.", flags: 1 << 6 }); return;
        }

        // If panel has questions, show modal
        if (panel.questions && panel.questions.length > 0) {
          const { ModalBuilder, ActionRowBuilder: MARB, TextInputBuilder, TextInputStyle } = await import("discord.js");
          const modal = new ModalBuilder()
            .setCustomId(`ticket:questions:${panelId}:${guildId}`)
            .setTitle(panel.embedTitle?.slice(0, 45) || "Open a Ticket");
          for (const [idx, q] of panel.questions.slice(0, 5).entries()) {
            modal.addComponents((new MARB() as any).addComponents(
              new TextInputBuilder()
                .setCustomId(`q${idx}`)
                .setLabel(q.label.slice(0, 45))
                .setStyle(q.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(q.required),
            ));
          }
          await interaction.showModal(modal);
          return;
        }

        // No questions — defer and create immediately
        await interaction.deferReply({ flags: 1 << 6 });
        const supportRoleId = panel.supportRoleId ?? tc.supportRoleId;
        const { ChannelType: CT, PermissionFlagsBits: PFB, EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = await import("discord.js");
        const num = await getNextTicketNumber(guildId, panelId);
        const ticketId = `${panel.name}-${String(num).padStart(3, "0")}`;
        const botMe = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
        if (!botMe) { await interaction.editReply("Could not resolve my member object — please try again."); return; }
        const overwrites: any[] = [
          { id: interaction.guild.id, deny: [PFB.ViewChannel] },
          { id: interaction.user.id, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ReadMessageHistory] },
          { id: botMe.id, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ManageChannels, PFB.ReadMessageHistory] },
        ];
        if (supportRoleId) overwrites.push({ id: supportRoleId, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ReadMessageHistory] });
        if (tc.adminRoleId) overwrites.push({ id: tc.adminRoleId, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ReadMessageHistory] });
        const channel = await interaction.guild.channels.create({
          name: ticketId, type: CT.GuildText, parent: panel.categoryId ?? undefined, permissionOverwrites: overwrites, reason: `Ticket by ${interaction.user.tag}`,
        });
        await createOpenTicket({ ticketId, panelId, channelId: channel.id, guildId, userId: interaction.user.id, createdAt: Date.now(), status: "open" });
        const welcomeEmbed = new EB().setTitle(`${CE.ticket.str} ${ticketId}`).setColor(panel.embedColor || 0x2b2d31)
          .setDescription(`Welcome, <@${interaction.user.id}>!\n\nSupport will be with you shortly.`)
          .setFooter({ text: "Use the buttons below to manage this ticket." }).setTimestamp();
        const ticketRow = new ARB().addComponents(
          new BB().setCustomId(`ticket:claim:${channel.id}:${guildId}`).setLabel("Claim").setStyle(BS.Primary).setEmoji("🙋"),
          new BB().setCustomId(`ticket:close:${channel.id}:${guildId}`).setLabel("Close Ticket").setStyle(BS.Danger).setEmoji({ id: CE.locked.id, name: CE.locked.name }),
        );
        const ping = supportRoleId ? `<@&${supportRoleId}>` : "";
        await channel.send({ content: `${ping} ${interaction.user}`.trim(), embeds: [welcomeEmbed], components: [ticketRow as any] });
        if (tc.logChannelId) {
          const logCh = interaction.guild.channels.cache.get(tc.logChannelId) as any;
          if (logCh?.send) await logCh.send({ embeds: [new EB().setColor(0x57f287).setTitle("Ticket Opened")
            .addFields({ name: "Ticket", value: `${channel} (\`${ticketId}\`)`, inline: true }, { name: "Opened by", value: `<@${interaction.user.id}>`, inline: true }, { name: "Panel", value: panel.name, inline: true })
            .setTimestamp()] }).catch(() => {});
        }
        await interaction.editReply(`Your ticket has been created: ${channel}`);
      } catch (err) {
        logger.error({ err }, "Error handling ticket:multipanel:select");
        if ((interaction as any).deferred || (interaction as any).replied) {
          await (interaction as any).editReply("Failed to create ticket.").catch(() => {});
        } else {
          await interaction.reply({ content: "Failed to create ticket. Check my permissions.", flags: 1 << 6 }).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("appeal:submit:")) {
        const { handleAppealModalSubmit } = await import("./utils/appealHandler");
        try {
          await handleAppealModalSubmit(interaction);
        } catch (err) {
          logger.error({ err }, "Error handling appeal modal submit");
          await interaction.reply({ content: "There was an error submitting your appeal.", flags: 1 << 6 }).catch(() => {});
        }
        return;
      }

      if (interaction.customId === "server_backup_take") {
        const { handleServerBackupTakeModalSubmit } = await import("./commands/server-backup");
        try {
          await handleServerBackupTakeModalSubmit(interaction);
        } catch (err) {
          logger.error({ err }, "Error handling server backup modal submit");
          await interaction.reply({ content: "There was an error taking the backup.", flags: 1 << 6 }).catch(() => {});
        }
        return;
      }

      if (interaction.customId.startsWith("dm-message|")) {
        const { handleDmModalSubmit } = await import("./commands/dm");
        try {
          await handleDmModalSubmit(interaction);
        } catch (err) {
          logger.error({ err }, "Error handling DM modal submit");
          const reply = { content: "There was an error sending the DM.", flags: 1 << 6 };
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply(reply).catch(() => {});
          } else {
            await interaction.reply(reply).catch(() => {});
          }
        }
        return;
      }

      // Ticket questions modal submit — user filled in pre-ticket form
      if (interaction.customId.startsWith("ticket:questions:")) {
        if (!interaction.guild || !interaction.guildId) {
          await interaction.reply({ content: "Could not process ticket.", flags: 1 << 6 }).catch(() => {}); return;
        }
        const parts = interaction.customId.split(":");
        const panelId = parts[2];
        const guildId = parts[3];
        await interaction.deferReply({ flags: 1 << 6 });
        try {
          const tc = await getTicketsConfig(guildId!);
          if (!tc.enabled) { await interaction.editReply("The ticket system is currently disabled."); return; }
          const panel = tc.panels[panelId!];
          if (!panel) { await interaction.editReply("This ticket panel no longer exists."); return; }
          const existing = await getOpenTicketsByUser(guildId!, interaction.user.id, panelId!);
          if (existing.length > 0) {
            const ch = interaction.guild.channels.cache.get(existing[0]!.channelId);
            await interaction.editReply(ch ? `You already have an open ticket: ${ch}` : "You already have an open ticket."); return;
          }

          // Collect the answers from the modal fields
          const answers: { label: string; answer: string }[] = [];
          for (const [idx, q] of (panel.questions ?? []).slice(0, 5).entries()) {
            const val = interaction.fields.getTextInputValue(`q${idx}`);
            answers.push({ label: q.label, answer: val });
          }

          const supportRoleId = panel.supportRoleId ?? tc.supportRoleId;
          const { ChannelType: CT, PermissionFlagsBits: PFB, EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = await import("discord.js");
          const num = await getNextTicketNumber(guildId!, panelId!);
          const ticketId = `${panel.name}-${String(num).padStart(3, "0")}`;
          const botMe = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
          if (!botMe) { await interaction.editReply("Could not resolve my member object — please try again."); return; }

          const overwrites: any[] = [
            { id: interaction.guild.id, deny: [PFB.ViewChannel] },
            { id: interaction.user.id, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ReadMessageHistory] },
            { id: botMe.id, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ManageChannels, PFB.ReadMessageHistory] },
          ];
          if (supportRoleId) overwrites.push({ id: supportRoleId, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ReadMessageHistory] });
          if (tc.adminRoleId) overwrites.push({ id: tc.adminRoleId, allow: [PFB.ViewChannel, PFB.SendMessages, PFB.ReadMessageHistory] });

          const channel = await interaction.guild.channels.create({
            name: ticketId, type: CT.GuildText, parent: panel.categoryId ?? undefined, permissionOverwrites: overwrites, reason: `Ticket by ${interaction.user.tag}`,
          });
          await createOpenTicket({ ticketId, panelId: panelId!, channelId: channel.id, guildId: guildId!, userId: interaction.user.id, createdAt: Date.now(), status: "open" });

          // Build welcome embed with answers included
          const welcomeEmbed = new EB()
            .setTitle(`${CE.ticket.str} ${ticketId}`)
            .setColor(panel.embedColor || 0x2b2d31)
            .setDescription(`Welcome, <@${interaction.user.id}>!\n\nSupport will be with you shortly.`)
            .setFooter({ text: "Use the buttons below to manage this ticket." })
            .setTimestamp();
          if (answers.length > 0) {
            welcomeEmbed.addFields(
              answers.map((a) => ({ name: a.label, value: a.answer.slice(0, 1024) || "*No answer*", inline: false })),
            );
          }

          const ticketRow = new ARB().addComponents(
            new BB().setCustomId(`ticket:claim:${channel.id}:${guildId}`).setLabel("Claim").setStyle(BS.Primary).setEmoji("🙋"),
            new BB().setCustomId(`ticket:close:${channel.id}:${guildId}`).setLabel("Close Ticket").setStyle(BS.Danger).setEmoji({ id: CE.locked.id, name: CE.locked.name }),
          );
          const ping = supportRoleId ? `<@&${supportRoleId}>` : "";
          await channel.send({ content: `${ping} ${interaction.user}`.trim(), embeds: [welcomeEmbed], components: [ticketRow as any] });
          if (tc.logChannelId) {
            const logCh = interaction.guild.channels.cache.get(tc.logChannelId) as any;
            if (logCh?.send) await logCh.send({ embeds: [new EB().setColor(0x57f287).setTitle("Ticket Opened")
              .addFields(
                { name: "Ticket", value: `${channel} (\`${ticketId}\`)`, inline: true },
                { name: "Opened by", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Panel", value: panel.name, inline: true },
              ).setTimestamp()] }).catch(() => {});
          }
          await interaction.editReply(`Your ticket has been created: ${channel}`);
        } catch (err) {
          logger.error({ err }, "Error handling ticket:questions modal submit");
          await interaction.editReply("Failed to create ticket. Check my permissions.").catch(() => {});
        }
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const command = commandMap.get(interaction.commandName);
    if (!command) {
      logger.warn({ commandName: interaction.commandName }, "Command not found");
      await interaction.reply({ content: "That command is not recognized.", flags: 1 << 6 }).catch(() => {});
      return;
    }
    const { isGloballyBlacklisted } = await import("./storage/blacklist");
    if (isGloballyBlacklisted(interaction.user.id)) {
      await interaction.reply({ content: "You are blacklisted from using bot commands.", flags: 1 << 6 }).catch(() => {});
      return;
    }
    try {
      await command.execute(interaction);
      // Log command execution to DISCORD_WEBHOOK_URL_1
      logCommandExecution({
        commandName: interaction.commandName,
        userId: interaction.user.id,
        username: interaction.user.username,
        guildId: interaction.guildId,
        guildName: interaction.guild?.name ?? null,
        channelId: interaction.channelId,
        channelName: interaction.channel && "name" in interaction.channel ? interaction.channel.name : null,
      }).catch(() => {});
    } catch (err) {
      logger.error({ err, commandName: interaction.commandName }, "Error executing command");
      const reply = { content: "There was an error executing this command.", flags: 1 << 6 };
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      } catch { /* ignore */ }
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Handle messages: quota tracking, prefix commands, DM forwarding
  // ────────────────────────────────────────────────────────────────────
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // Handle AFK functionality
    try {
      const { handleAFK } = await import("./commands/afk");
      await handleAFK(message);
    } catch (err) {
      logger.error({ err }, "Error in AFK handler");
    }

    // ── Automod ─────────────────────────────────────────────────────────────
    if (message.guild && message.inGuild() && message.member) {
      try {
        const am = await getAutomodConfig(message.guildId);
        if (am.enabled) {
          const member = message.member;
          const content = message.content || "";
          const exempted = (r: { exemptRoleIds: string[]; exemptChannelIds: string[] }) =>
            r.exemptRoleIds.some((id) => member.roles.cache.has(id)) || r.exemptChannelIds.includes(message.channelId);
          const doAction = async (action: string, reason: string, muteDuration: number) => {
            await message.delete().catch(() => {});
            if (action === "warn") {
              await message.channel.send({ content: `${CE.warning.str} ${member} — **Automod Warning**: ${reason}` }).then((m) => setTimeout(() => m.delete().catch(() => {}), 8000)).catch(() => {});
            } else if (action === "mute") {
              await member.timeout(muteDuration * 60_000, reason).catch(() => {});
              await message.channel.send({ content: `${CE.mute.str} Muted ${member} (${muteDuration}m): ${reason}` }).then((m) => setTimeout(() => m.delete().catch(() => {}), 10000)).catch(() => {});
            } else if (action === "kick") {
              await member.kick(reason).catch(() => {});
              await message.channel.send({ content: `${CE.automod.str} Kicked ${member}: ${reason}` }).then((m) => setTimeout(() => m.delete().catch(() => {}), 10000)).catch(() => {});
            } else if (action === "ban") {
              await member.ban({ reason }).catch(() => {});
              await message.channel.send({ content: `${CE.automod.str} Banned ${member}: ${reason}` }).then((m) => setTimeout(() => m.delete().catch(() => {}), 10000)).catch(() => {});
            } else {
              await message.channel.send({ content: `${CE.automod.str} ${member} — Your message was removed by **Automod** (${reason}).` }).then((m) => setTimeout(() => m.delete().catch(() => {}), 8000)).catch(() => {});
            }
            if (am.logChannelId) {
              const logCh = message.guild?.channels.cache.get(am.logChannelId) as any;
              if (logCh?.send) {
                const { EmbedBuilder: EB } = await import("discord.js");
                await logCh.send({ embeds: [new EB().setColor(0xed4245).setTitle(`${CE.automod.str} Automod`).addFields(
                  { name: "User", value: `${member} (${member.id})`, inline: true }, { name: "Action", value: action, inline: true },
                  { name: "Reason", value: reason, inline: true }, { name: "Channel", value: `<#${message.channelId}>`, inline: true },
                  { name: "Content", value: content.slice(0, 500) || "*(empty)*", inline: false },
                ).setTimestamp()] }).catch(() => {});
              }
            }
          };
          // Spam
          if ((am.spam.enabled || am.enabled) && !exempted(am.spam)) {
            if (recordSpam(message.guildId, message.author.id) >= (am.spam.threshold || 4)) { await doAction(am.spam.action || "delete", "Spam rate limit exceeded", am.spam.muteDurationMinutes || 10); return; }
          }
          // Duplicates
          if ((am.duplicates.enabled || am.enabled) && !exempted(am.duplicates)) {
            if (recordDuplicate(message.guildId, message.author.id, content)) { await doAction(am.duplicates.action || "delete", "Duplicate message", am.duplicates.muteDurationMinutes || 10); return; }
          }
          // Bad words (custom + built-in profanity)
          if ((am.badWords.enabled || am.enabled) && !exempted(am.badWords)) {
            const builtInWords = ["fuck", "shit", "bitch", "asshole", "cunt", "nigger", "faggot", "retard", "whore", "slut"];
            const allWords = [...builtInWords, ...(am.badWords.words || [])];
            if (allWords.some((w) => content.toLowerCase().includes(w.toLowerCase()))) { await doAction(am.badWords.action || "delete", "Prohibited language detected", am.badWords.muteDurationMinutes || 10); return; }
          }
          // Invites
          if ((am.invites.enabled || am.enabled) && !exempted(am.invites) && /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\//i.test(content)) {
            await doAction(am.invites.action || "delete", "Discord invites not allowed", am.invites.muteDurationMinutes || 10);
            return;
          }
          // Links
          if (am.links.enabled && !exempted(am.links)) {
            const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-z0-9-]+\.(com|net|org|io|gg|co|xyz|info|biz|ru|cn|top)(\/[^\s]*)?)/gi;
            const urls = content.match(urlRegex) ?? [];
            const allowed = am.links.whitelist.map((d) => d.toLowerCase());
            if (urls.length > 0 && urls.some((url) => { const dom = (url as string).replace(/https?:\/\//i,"").replace(/^www\./i,"").split("/")[0]!.toLowerCase(); return !allowed.some((a) => dom===a||dom.endsWith("."+a)); })) {
              await doAction(am.links.action || "delete", "Links not allowed", am.links.muteDurationMinutes || 10); return;
            }
          }
          // Caps
          if ((am.caps.enabled || am.enabled) && !exempted(am.caps) && content.length >= 6) {
            const caps = [...content].filter((c) => c>="A"&&c<="Z").length;
            const letters = [...content].filter((c) => (c>="A"&&c<="Z")||(c>="a"&&c<="z")).length;
            if (letters >= 4 && (caps/letters)*100 >= (am.caps.percent || 70)) { await doAction(am.caps.action || "delete", "Excessive caps detected", am.caps.muteDurationMinutes || 10); return; }
          }
          // Mentions / Pings
          if ((am.mentions.enabled || am.enabled) && !exempted(am.mentions)) {
            const mentionCount = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 3 : 0);
            if (mentionCount >= (am.mentions.threshold || 3)) {
              await doAction(am.mentions.action || "delete", "Mass mentions / pings detected", am.mentions.muteDurationMinutes || 10); return;
            }
          }
          // Newlines / Multilines
          if ((am.newlines.enabled || am.enabled) && !exempted(am.newlines)) {
            const newlineCount = (content.match(/\n/g) ?? []).length;
            const consecutiveNewlines = /[\r\n]{4,}/.test(content);
            if (newlineCount >= (am.newlines.threshold || 5) || consecutiveNewlines) {
              await doAction(am.newlines.action || "delete", "Excessive newlines / multiline flooding", am.newlines.muteDurationMinutes || 10); return;
            }
          }
          // AI Automod (Text + NSFW)
          if ((am.aiAutomod.enabled || am.enabled) && !exempted(am.aiAutomod)) {
            const isNsfwChannel = Boolean((message.channel as any).nsfw);
            // Check attachments for NSFW filenames in non-NSFW channels
            if (!isNsfwChannel && message.attachments.size > 0) {
              const nsfwAttachment = message.attachments.some((att) =>
                /\b(nsfw|porn|hentai|nude|xxx|onlyfans|rule34)\b/i.test(att.name || "")
              );
              if (nsfwAttachment) {
                await doAction(am.aiAutomod.action || "delete", "NSFW attachment detected in non-NSFW channel", am.aiAutomod.muteDurationMinutes || 10);
                return;
              }
            }
            if (content.trim().length > 0) {
              const { classifyContent, categoryLabel } = await import("./utils/aiAutomod");
              const result = classifyContent(content, am.aiAutomod.whitelist ?? []);
              const cats = am.aiAutomod.categories.length > 0 ? am.aiAutomod.categories : ["threat","hate_speech","slur","harassment","explicit","self_harm","scam","spam","nsfw"];
              if (result.flagged && (cats.includes(result.category) || result.category === "nsfw") && result.confidence >= (am.aiAutomod.minConfidence || 70)) {
                // If NSFW content in an NSFW channel, allow it; otherwise flag
                if (result.category === "nsfw" && isNsfwChannel) {
                  // allowed in marked NSFW channels
                } else {
                  const reason = `AI Automod: ${categoryLabel(result.category)} detected (${result.confidence}% confidence)`;
                  await doAction(am.aiAutomod.action || "delete", reason, am.aiAutomod.muteDurationMinutes || 10);
                  return;
                }
              }
            }
          }
        }
      } catch (err) { logger.warn({ err }, "Automod error"); }
    }

    // ── Forward incoming DMs to the MESSAGE_LOGS webhook ────────────
    if (!message.guild) {
      await logDmToWebhook({
        direction: "in",
        userId: message.author.id,
        username: message.author.username,
        content: message.content,
        attachments: message.attachments.size > 0
          ? [...message.attachments.values()].map((a) => a.url)
          : undefined,
      }).catch(() => {});
      return;
    }

    // ── Guild messages: quota + prefix commands ──────────────────────
    try {
      if (message.inGuild() && message.guildId && message.member) {
        const cfg = await getGuildConfig(message.guildId);
        if (cfg.quotaConfig) {
          const staffRoles = await listStaffRoles(message.guildId);
          const isStaff = staffRoles.some((role) => message.member!.roles.cache.has(role.roleId));
          if (isStaff) {
            await bumpMessage(
              message.guildId,
              message.author.id,
              cfg.quotaConfig.weekStartDay,
            ).catch(() => {});
          }
        }
      }

      await handlePrefixMessage(message);

      // ── Levels XP (message) ──────────────────────────────────────────────
      if (message.inGuild() && message.guildId && message.member && !message.author.bot) {
        try {
          const { getLevelConfig, getMemberLevel, setMemberLevel } = await import("./storage/levels");
          const { levelFromTotalXp, totalXpForLevel, xpToNextLevel } = await import("./utils/levelCalc");
          const lc = await getLevelConfig(message.guildId);
          if (lc.enabled) {
            const mem = message.member;
            if (!lc.ignoredChannels.includes(message.channelId) &&
                (lc.allowedChannels.length === 0 || lc.allowedChannels.includes(message.channelId)) &&
                !lc.ignoredRoles.some((r) => mem.roles.cache.has(r))) {
              const md = await getMemberLevel(message.guildId, message.author.id);
              const now = Date.now();
              if (now - md.lastMessageXp >= lc.xpCooldownSeconds * 1000) {
                const gain = Math.floor(Math.random() * (lc.xpPerMessageMax - lc.xpPerMessageMin + 1)) + lc.xpPerMessageMin;
                const oldLevel = md.level;
                const rawTotal = md.totalXp + gain;
                const rawLevel = levelFromTotalXp(rawTotal);
                const newLevel = lc.levelLimit !== null ? Math.min(lc.levelLimit, rawLevel) : rawLevel;
                const newTotalXp = (lc.levelLimit !== null && newLevel >= lc.levelLimit) ? totalXpForLevel(lc.levelLimit) : rawTotal;
                const newData = { xp: newTotalXp - totalXpForLevel(newLevel), level: newLevel, totalXp: newTotalXp, lastMessageXp: now };
                await setMemberLevel(message.guildId, message.author.id, newData);
                if (newLevel > oldLevel && lc.levelUpAnnounce) {
                  const { EmbedBuilder: LEB } = await import("discord.js");
                  const lvMsg = lc.embedMessage.replace("{user}", `${mem}`).replace("{level}", String(newLevel));
                  const ch: any = lc.levelUpChannel
                    ? (message.guild?.channels.cache.get(lc.levelUpChannel) ?? message.channel)
                    : message.channel;
                  if (ch?.send) await ch.send({ embeds: [new LEB().setColor(lc.embedColor ?? 0x2b2d31).setDescription(`${CE.trophy.str} ${lvMsg}`).setThumbnail(mem.displayAvatarURL()).setFooter({ text: `Level ${newLevel}` })] }).catch(() => {});
                  if (lc.levelRoles.length > 0) {
                    const eligible = lc.levelRoles.filter((lr) => lr.level <= newLevel).map((lr) => lr.roleId);
                    if (!lc.stackRoles) {
                      const old = lc.levelRoles.filter((lr) => lr.level < newLevel).map((lr) => lr.roleId).filter((id) => mem.roles.cache.has(id));
                      if (old.length) await mem.roles.remove(old, "Level role update").catch(() => {});
                    }
                    const toAdd = eligible.filter((id) => !mem.roles.cache.has(id));
                    if (toAdd.length) await mem.roles.add(toAdd, `Level ${newLevel} reward`).catch(() => {});
                  }
                }
              }
            }
          }
        } catch (lvErr) { logger.warn({ lvErr }, "Levels XP error (message)"); }
      }
    } catch (err) {
      logger.error({ err }, "Error handling prefix message");
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Role memory + Anti-Join
  // ────────────────────────────────────────────────────────────────────
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const { handleAntiJoin } = await import("./utils/antiNuke");
      await handleAntiJoin(member.guild, member);
    } catch (err) {
      logger.error({ err, guildId: member.guild.id, userId: member.id }, "Error handling anti-join");
    }

    try {
      const { getGuildConfig: getCfg } = await import("./storage/config");
      const { getMemberRoles } = await import("./storage/memberRoles");

      const config = await getCfg(member.guild.id);
      if (config.modules.roleMemory) {
        const savedRoleIds = await getMemberRoles(member.guild.id, member.id);
        if (savedRoleIds && savedRoleIds.length > 0) {
          const rolesToAdd: string[] = [];
          for (const roleId of savedRoleIds) {
            const role = member.guild.roles.cache.get(roleId);
            if (role && !member.roles.cache.has(roleId)) {
              rolesToAdd.push(roleId);
            }
          }

          if (rolesToAdd.length > 0) {
            await member.roles.add(rolesToAdd, "Role Memory: restoring on rejoin").catch((err) => {
              logger.warn({ err, guildId: member.guild.id, userId: member.id }, "Failed to restore member roles");
            });
          }
        }
      }
    } catch (err) {
      logger.error({ err, guildId: member.guild.id, userId: member.id }, "Error handling role memory restore");
    }

    // Welcomer
    try {
      const { getWelcomerConfig } = await import("./storage/welcomer");
      const { generateWelcomeImage } = await import("./utils/welcomeImage");
      const { buildWelcomerEmbed, buildWelcomerText, applyWelcomerPlaceholders } = await import("./utils/welcomeSender");
      const { AttachmentBuilder, ChannelType } = await import("discord.js");

      const wc = await getWelcomerConfig(member.guild.id);
      if (wc.enabled) {
        const user = member.user;
        const guild = member.guild;
        const count = guild.memberCount;

        // Channel welcome
        if (wc.channel.enabled && wc.channel.channelId) {
          const ch = await guild.channels.fetch(wc.channel.channelId).catch(() => null);
          if (ch && ch.type === ChannelType.GuildText) {
            const textCh = ch as import("discord.js").TextChannel;
            const chAbove = wc.channel.aboveText
              ? applyWelcomerPlaceholders(wc.channel.aboveText, user, guild, count)
              : undefined;
            if (wc.channel.mode === "embed") {
              const embed = buildWelcomerEmbed(wc.channel.embed ?? {}, user, guild, count);
              if (wc.channel.embed?.showAvatar !== false) embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
              await textCh.send({ content: chAbove, embeds: [embed] });
            } else if (wc.channel.mode === "image") {
              const buf = await generateWelcomeImage({
                avatarUrl: user.displayAvatarURL({ extension: "png", size: 256 }),
                username: user.username,
                memberCount: count,
                serverName: guild.name,
              });
              const att = new AttachmentBuilder(buf, { name: "welcome.png" });
              await textCh.send({ content: chAbove, files: [att] });
            } else {
              const text = applyWelcomerPlaceholders(wc.channel.message ?? "Welcome {user} to **{server}**!", user, guild, count);
              await textCh.send({ content: text });
            }
          }
        }

        // DM welcome
        if (wc.dm.enabled) {
          const dmAbove = wc.dm.aboveText
            ? applyWelcomerPlaceholders(wc.dm.aboveText, user, guild, count)
            : undefined;
          if (wc.dm.mode === "embed") {
            const embed = buildWelcomerEmbed(wc.dm.embed ?? {}, user, guild, count);
            await user.send({ content: dmAbove, embeds: [embed] }).catch(() => {});
          } else {
            const text = applyWelcomerPlaceholders(wc.dm.message ?? "Welcome to **{server}**, {username}!", user, guild, count);
            await user.send({ content: dmAbove ? `${dmAbove}\n${text}` : text }).catch(() => {});
          }
        }
      }
    } catch (err) {
      logger.error({ err, guildId: member.guild.id, userId: member.id }, "Error handling welcomer");
    }

    try {
      const { safeDispatchMemberJoin } = await import("./utils/automations");
      safeDispatchMemberJoin(member);
    } catch (err) {
      logger.error({ err, guildId: member.guild.id, userId: member.id }, "Error handling automations on join");
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Track role changes + Anti-Role
  // ────────────────────────────────────────────────────────────────────
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      const { getGuildConfig: getCfg } = await import("./storage/config");
      const { saveMemberRoles } = await import("./storage/memberRoles");

      const config = await getCfg(newMember.guild.id);
      if (!config.modules.roleMemory) return;

      if (oldMember.roles.cache.size === newMember.roles.cache.size &&
          oldMember.roles.cache.every((r) => newMember.roles.cache.has(r.id))) {
        return;
      }

      const roleIds = Array.from(newMember.roles.cache.values())
        .map((r) => r.id)
        .filter((id) => id !== newMember.guild.id);

      await saveMemberRoles(newMember.guild.id, newMember.id, roleIds);
    } catch (err) {
      logger.error({ err, guildId: newMember.guild.id, userId: newMember.id }, "Error updating member role memory");
    }

    try {
      const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
      if (addedRoles.size === 0) return;
      const { isDangerousRole, handleAntiRole } = await import("./utils/antiNuke");
      const hasDangerous = addedRoles.some((r) => isDangerousRole(r.permissions.bitfield));
      if (!hasDangerous) return;
      const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 }).catch(() => null);
      const entry = logs?.entries.find((e) => (e.target as { id?: string } | null)?.id === newMember.id);
      const executorId = entry?.executor?.id ?? null;
      if (executorId === client.user?.id) return;
      await handleAntiRole(newMember.guild, executorId, "Dangerous role assigned");
    } catch (err) {
      logger.error({ err, guildId: newMember.guild.id, userId: newMember.id }, "Error handling anti-role (member update)");
    }

    try {
      const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id)).map(r => r.id);
      const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id)).map(r => r.id);
      if (addedRoles.length > 0 || removedRoles.length > 0) {
        const { safeDispatchRoleChange } = await import("./utils/automations");
        safeDispatchRoleChange(newMember, addedRoles, removedRoles);
      }
    } catch (err) {
      logger.error({ err, guildId: newMember.guild.id, userId: newMember.id }, "Error handling automations on role change");
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Anti-Nuke: ban / kick / role / channel detection
  // ────────────────────────────────────────────────────────────────────
  client.on(Events.GuildBanAdd, async (ban) => {
    try {
      const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 }).catch(() => null);
      const entry = logs?.entries.find((e) => (e.target as { id?: string } | null)?.id === ban.user.id);
      const executorId = entry?.executor?.id ?? null;
      if (executorId === client.user?.id) return;
      const { handleAntiBan } = await import("./utils/antiNuke");
      await handleAntiBan(ban.guild, executorId);
    } catch (err) {
      logger.error({ err, guildId: ban.guild.id }, "Error handling anti-ban");
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 }).catch(() => null);
      const entry = logs?.entries.find(
        (e) =>
          (e.target as { id?: string } | null)?.id === member.id &&
          Date.now() - e.createdTimestamp < 10_000,
      );
      if (!entry) return;
      const executorId = entry.executor?.id ?? null;
      if (executorId === client.user?.id) return;
      const { handleAntiKick } = await import("./utils/antiNuke");
      await handleAntiKick(member.guild, executorId);
    } catch (err) {
      logger.error({ err, guildId: member.guild.id }, "Error handling anti-kick");
    }

    try {
      const { safeDispatchMemberLeave } = await import("./utils/automations");
      safeDispatchMemberLeave(member.guild, member.user);
    } catch (err) {
      logger.error({ err, guildId: member.guild.id, userId: member.id }, "Error handling automations on leave");
    }
  });

  client.on(Events.GuildRoleCreate, async (role) => {
    try {
      const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 5 }).catch(() => null);
      const entry = logs?.entries.first();
      const executorId = entry?.executor?.id ?? null;
      if (executorId === client.user?.id) return;
      const { handleAntiRole } = await import("./utils/antiNuke");
      await handleAntiRole(role.guild, executorId, "Unauthorized role created");
    } catch (err) {
      logger.error({ err, guildId: role.guild.id }, "Error handling anti-role (create)");
    }
  });

  client.on(Events.GuildRoleDelete, async (role) => {
    try {
      const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 5 }).catch(() => null);
      const entry = logs?.entries.first();
      const executorId = entry?.executor?.id ?? null;
      if (executorId === client.user?.id) return;
      const { handleAntiRole } = await import("./utils/antiNuke");
      await handleAntiRole(role.guild, executorId, "Unauthorized role deleted");
    } catch (err) {
      logger.error({ err, guildId: role.guild.id }, "Error handling anti-role (delete)");
    }
  });

  client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;
    try {
      const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 5 }).catch(() => null);
      const entry = logs?.entries.first();
      const executorId = entry?.executor?.id ?? null;
      if (executorId === client.user?.id) return;
      const { handleAntiChannel } = await import("./utils/antiNuke");
      await handleAntiChannel(channel.guild, executorId, "Unauthorized channel created");
    } catch (err) {
      logger.error({ err, guildId: channel.guild?.id }, "Error handling anti-channel (create)");
    }
  });

  client.on(Events.ChannelDelete, async (channel) => {
    if (!("guild" in channel) || !channel.guild) return;
    try {
      const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 5 }).catch(() => null);
      const entry = logs?.entries.first();
      const executorId = entry?.executor?.id ?? null;
      if (executorId === client.user?.id) return;
      const { handleAntiChannel } = await import("./utils/antiNuke");
      await handleAntiChannel(channel.guild, executorId, "Unauthorized channel deleted");
    } catch (err) {
      logger.error({ err, guildId: (channel as any).guild?.id }, "Error handling anti-channel (delete)");
    }
  });

  // ── Levels XP (VC tracking) ──────────────────────────────────────────────
  const vcJoinMap = new Map<string, number>(); // key: guildId:userId → join timestamp

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guildId = newState.guild.id;
    const userId = newState.member?.id ?? newState.id;
    const key = `${guildId}:${userId}`;
    const isBot = newState.member?.user.bot ?? false;
    if (isBot) return;

    // User joined a voice channel (or switched channels)
    if (newState.channelId && (!oldState.channelId || newState.channelId !== oldState.channelId)) {
      vcJoinMap.set(key, Date.now());
    }

    // User left a voice channel
    if (!newState.channelId && oldState.channelId) {
      const joinTime = vcJoinMap.get(key);
      vcJoinMap.delete(key);
      if (!joinTime) return;
      try {
        const { getLevelConfig, addMemberXp, getMemberLevel, setMemberLevel } = await import("./storage/levels");
        const { levelFromTotalXp, totalXpForLevel } = await import("./utils/levelCalc");
        const lc = await getLevelConfig(guildId);
        if (!lc.enabled || lc.xpPerVcMinute <= 0) return;
        const minutesInVc = Math.floor((Date.now() - joinTime) / 60_000);
        if (minutesInVc < 1) return;
        const xpGain = minutesInVc * lc.xpPerVcMinute;
        const md = await getMemberLevel(guildId, userId);
        const oldLevel = md.level;
        const rawTotal = md.totalXp + xpGain;
        const rawLevel = levelFromTotalXp(rawTotal);
        const newLevel = lc.levelLimit !== null ? Math.min(lc.levelLimit, rawLevel) : rawLevel;
        const newTotalXp = (lc.levelLimit !== null && newLevel >= lc.levelLimit) ? totalXpForLevel(lc.levelLimit) : rawTotal;
        await setMemberLevel(guildId, userId, { xp: newTotalXp - totalXpForLevel(newLevel), level: newLevel, totalXp: newTotalXp, lastMessageXp: md.lastMessageXp });
        if (newLevel > oldLevel && lc.levelUpAnnounce && lc.levelUpChannel) {
          const { EmbedBuilder: LEB } = await import("discord.js");
          const mem = newState.guild.members.cache.get(userId);
          const ch: any = lc.levelUpChannel ? (newState.guild.channels.cache.get(lc.levelUpChannel) ?? null) : null;
          if (ch?.send && mem) {
            const lvMsg = lc.embedMessage.replace("{user}", `${mem}`).replace("{level}", String(newLevel));
            await ch.send({ embeds: [new LEB().setColor(lc.embedColor ?? 0x2b2d31).setDescription(`${CE.trophy.str} ${lvMsg}`).setThumbnail(mem.displayAvatarURL()).setFooter({ text: `Level ${newLevel} (VC)` })] }).catch(() => {});
          }
        }
      } catch (err) { logger.warn({ err }, "Levels XP error (VC)"); }
    }
  });

  await client.login(token);
}


