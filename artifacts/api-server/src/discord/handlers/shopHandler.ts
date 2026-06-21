/**
 * Shop System Interaction Handler
 * Handles all shop: prefixed button/select interactions outside the config collector.
 *
 * CustomId patterns:
 *  shop:buy:{guildId}:{shopId}            — "Buy" button on shop embed
 *  shop:claim:{guildId}:{ticketId}        — "Claim" button inside ticket
 *  shop:precl:{guildId}:{ticketId}        — Outcome picker (after close click)
 *  shop:outcome:s:{guildId}:{ticketId}    — "Service Successful" -> item/price modal
 *  shop:outcome:f:{guildId}:{ticketId}    — "Unsuccessful" -> immediate close
 *  shop:rate:{ticketId}:{rating}          — Rating button 1-10 in DM
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CategoryChannel,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Interaction,
  type TextChannel,
} from "discord.js";
import { getShopSettings } from "../storage/shop";
import { listStaffRoles } from "../storage/staff";
import { getTicketById, saveTicket, updateTicket, type ShopTicket } from "../storage/shopTickets";
import {
  addSale,
  addPurchase,
  getStaffShopStats,
  getCustomerRecord,
  updateStaffSale,
  avgRating,
} from "../storage/shopStats";
import { CE, COLORS, prettyEmbed } from "../utils/embedStyle";
import { logger } from "../../lib/logger";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ticketControlRow(guildId: string, ticketId: string, claimed: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (!claimed) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`shop:claim:${guildId}:${ticketId}`)
        .setLabel("Claim Ticket")
        .setStyle(ButtonStyle.Primary)
        .setEmoji(CE.shoppingcart.str),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`shop:precl:${guildId}:${ticketId}`)
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
      .setEmoji(CE.cash.str),
  );
  return row;
}

function ratingRow1(ticketId: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 1; i <= 5; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`shop:rate:${ticketId}:${i}`)
        .setLabel(`${i}`)
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

function ratingRow2(ticketId: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 6; i <= 10; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`shop:rate:${ticketId}:${i}`)
        .setLabel(`${i}`)
        .setStyle(i >= 9 ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
  }
  return row;
}

async function generateTranscript(channel: TextChannel): Promise<Buffer> {
  const lines: string[] = [`# Ticket Transcript — #${channel.name}`, `Generated: ${new Date().toUTCString()}`, ""];
  let lastId: string | undefined;
  const allMessages: { createdAt: Date; author: string; content: string; attachments: string[] }[] = [];

  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages
      .fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) })
      .catch(() => null);
    if (!batch || batch.size === 0) break;
    for (const msg of batch.values()) {
      allMessages.push({
        createdAt: msg.createdAt,
        author: `${msg.author.tag} (${msg.author.id})`,
        content: msg.content,
        attachments: msg.attachments.map((a) => a.url),
      });
    }
    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const m of allMessages) {
    const ts = m.createdAt.toISOString();
    lines.push(`[${ts}] ${m.author}`);
    if (m.content) lines.push(m.content);
    if (m.attachments.length > 0) lines.push(`Attachments: ${m.attachments.join(", ")}`);
    lines.push("");
  }

  return Buffer.from(lines.join("\n"), "utf-8");
}

async function finalizeClose(
  client: Client,
  ticket: ShopTicket,
  outcome: "success" | "failure",
  item?: string,
  price?: string,
): Promise<void> {
  // NOTE: Do NOT early-return when guild is unavailable — DM, stats, and ticket
  // updates must always run regardless of guild reachability.
  const guild = client.guilds.cache.get(ticket.guildId) ?? await client.guilds.fetch(ticket.guildId).catch(() => null);
  const shopSettings = guild ? await getShopSettings(ticket.guildId) : null;
  const channel = guild ? guild.channels.cache.get(ticket.channelId) as TextChannel | null : null;

  // Generate and send transcript (guild-dependent)
  if (guild && shopSettings && channel && shopSettings.transcriptChannelId) {
    try {
      const transcriptCh = guild.channels.cache.get(shopSettings.transcriptChannelId) as TextChannel | null;
      if (transcriptCh) {
        const buf = await generateTranscript(channel);
        await transcriptCh.send({
          embeds: [prettyEmbed({
            title: `${CE.shoppingcart.str} Transcript — ${ticket.ticketId}`,
            color: outcome === "success" ? COLORS.success : COLORS.danger,
            fields: [
              { name: "Shop", value: ticket.shopName, inline: true },
              { name: "Customer", value: `<@${ticket.userId}>`, inline: true },
              { name: "Staff", value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "Unclaimed", inline: true },
              { name: "Outcome", value: outcome === "success"
                  ? `${CE.cash.str} Successful${item ? ` — **${item}** ${CE.ltc.str} ${price}` : ""}`
                  : `${CE.discount.str} Unsuccessful`, inline: false },
            ],
          })],
          files: [{ attachment: buf, name: `${ticket.ticketId}.txt` }],
        }).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err }, "[Shop] Failed to send transcript");
    }
  }

  // Log (guild-dependent)
  if (guild && shopSettings && shopSettings.logChannelId) {
    const logCh = guild.channels.cache.get(shopSettings.logChannelId) as TextChannel | null;
    if (logCh) {
      await logCh.send({
        embeds: [prettyEmbed({
          title: outcome === "success"
            ? `${CE.cash.str} Sale Completed`
            : `${CE.discount.str} Ticket Closed — Unsuccessful`,
          color: outcome === "success" ? COLORS.success : COLORS.danger,
          fields: [
            { name: "Ticket", value: ticket.ticketId, inline: true },
            { name: "Shop", value: ticket.shopName, inline: true },
            { name: "Customer", value: `<@${ticket.userId}>`, inline: true },
            { name: "Staff", value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "Unclaimed", inline: true },
            ...(outcome === "success" && item ? [
              { name: `${CE.cash.str} Item`, value: item, inline: true },
              { name: `${CE.ltc.str} Price`, value: price ?? "N/A", inline: true },
            ] : []),
          ],
        })],
      }).catch(() => {});
    }
  }

  // Record stats and send feedback DM if successful
  if (outcome === "success" && item) {
    const saleDate = Date.now();

    // Staff stats — only when ticket was claimed
    if (ticket.claimedBy) {
      await addSale(ticket.guildId, ticket.claimedBy, {
        ticketId: ticket.ticketId,
        item,
        price: price ?? "N/A",
        date: saleDate,
        customerId: ticket.userId,
      });
    }

    const prevRecord = await getCustomerRecord(ticket.guildId, ticket.userId);
    const isFirstPurchase = prevRecord.purchases.length === 0;
    await addPurchase(ticket.guildId, ticket.userId, {
      ticketId: ticket.ticketId,
      item,
      price: price ?? "N/A",
      date: saleDate,
      staffId: ticket.claimedBy ?? "",
    });

    // Assign customer role on first purchase (guild-dependent)
    if (guild && shopSettings && isFirstPurchase && shopSettings.customerRoleId) {
      try {
        const member = await guild.members.fetch(ticket.userId).catch(() => null);
        if (member && !member.roles.cache.has(shopSettings.customerRoleId)) {
          await member.roles.add(shopSettings.customerRoleId, "First shop purchase").catch(() => {});
        }
      } catch (err) {
        logger.warn({ err }, "[Shop] Failed to assign customer role");
      }
    }

    // DM customer for rating — always attempted on successful close
    try {
      const customer = await client.users.fetch(ticket.userId).catch(() => null);
      if (customer) {
        const ratingEmbed = new EmbedBuilder()
          .setTitle(`${CE.star_rating.str} Rate Your Experience`)
          .setDescription(`Thanks for purchasing from **${ticket.shopName}**!\nPlease rate the service you received out of 10.\n\n**What you got:** ${item} @ ${price}`)
          .setColor(COLORS.primary)
          .setTimestamp();
        const dmSent = await customer.send({
          embeds: [ratingEmbed],
          components: [ratingRow1(ticket.ticketId), ratingRow2(ticket.ticketId)],
        }).catch((err) => {
          logger.warn({ err, userId: ticket.userId }, "[Shop] Failed to DM customer for rating (DMs may be disabled)");
          return null;
        });
        // Fallback: post rating prompt in the ticket channel before it's deleted
        if (!dmSent && channel) {
          await channel.send({
            content: `<@${ticket.userId}> We couldn't DM you — please rate your experience here before this ticket closes:`,
            embeds: [ratingEmbed],
            components: [ratingRow1(ticket.ticketId), ratingRow2(ticket.ticketId)],
          }).catch(() => {});
        }
      }
    } catch (err) {
      logger.warn({ err }, "[Shop] Unexpected error sending rating DM");
    }
  }

  // Update ticket record
  await updateTicket(ticket.channelId, (t) => ({
    ...t,
    status: "closed",
    outcome,
    item: item ?? t.item,
    price: price ?? t.price,
    closedAt: Date.now(),
  }));

  // Delete the ticket channel after a short delay
  if (channel) {
    await new Promise((r) => setTimeout(r, 3000));
    channel.delete(`Ticket closed — ${outcome}`).catch(() => {});
  }
}

// ── Main Handler ──────────────────────────────────────────────────────────────

export async function handleShopInteraction(interaction: Interaction, client: Client): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return false;
  const id = interaction.customId;
  if (!id.startsWith("shop:")) return false;

  const parts = id.split(":");
  const action = parts[1];

  try {
    // ── Buy ──────────────────────────────────────────────────────────────────
    if (action === "buy") {
      const guildId = parts[2];
      const shopId = parts[3];
      if (!interaction.isButton() || !interaction.inGuild()) return true;

      const guild = interaction.guild ?? await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) { await interaction.reply({ content: "Server not found.", flags: 1 << 6 }); return true; }

      const ss = await getShopSettings(guildId);
      if (!ss.enabled) { await interaction.reply({ content: "The shop is currently disabled.", flags: 1 << 6 }); return true; }
      const shop = ss.shops[shopId];
      if (!shop) { await interaction.reply({ content: "This shop no longer exists.", flags: 1 << 6 }); return true; }

      const shopStatus = shop.status ?? "active";
      if (shopStatus === "coming_soon") {
        await interaction.reply({ content: `${CE.limited.str} **${shop.name}** is coming soon! Stay tuned.`, flags: 1 << 6 });
        return true;
      }
      if (shopStatus === "out_of_stock") {
        await interaction.reply({ content: `${CE.discount.str} **${shop.name}** is currently out of stock. Check back later!`, flags: 1 << 6 });
        return true;
      }

      const questions = shop.questions.length > 0
        ? shop.questions
        : ["What would you like to purchase?"];

      const modal = new ModalBuilder()
        .setCustomId(`shop:buyModal:${guildId}:${shopId}`)
        .setTitle(`Purchase — ${shop.name}`.slice(0, 45));

      for (let i = 0; i < Math.min(questions.length, 5); i++) {
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId(`q${i}`)
              .setLabel(questions[i].slice(0, 45))
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(300),
          ),
        );
      }

      await interaction.showModal(modal);

      let submit;
      try {
        submit = await interaction.awaitModalSubmit({
          filter: (s) => s.customId === `shop:buyModal:${guildId}:${shopId}` && s.user.id === interaction.user.id,
          time: 10 * 60 * 1000,
        });
      } catch { return true; }

      const answers: string[] = questions
        .slice(0, 5)
        .map((_, i) => submit.fields.getTextInputValue(`q${i}`));

      // Increment ticket counter
      const updatedSS = await (await import("../storage/shop")).updateShopSettings(guildId, (s) => {
        s.ticketCounter = (s.ticketCounter ?? 0) + 1;
        return s;
      });
      const ticketNo = updatedSS.ticketCounter;

      const shopSlug = (await import("../storage/shop")).sanitizeForChannel(shop.name);
      const userSlug = (await import("../storage/shop")).sanitizeForChannel(interaction.user.username);
      const channelName = `${shopSlug}-${userSlug}-${ticketNo}`.slice(0, 100);
      const ticketId = `${shopSlug}-${userSlug}-${ticketNo}`;

      // Create ticket channel
      let parent: CategoryChannel | undefined;
      if (shop.categoryId) {
        parent = guild.channels.cache.get(shop.categoryId) as CategoryChannel | undefined;
      }

      const permissionOverwrites: any[] = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ];
      for (const roleId of ss.adminRoleIds) {
        permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
      }
      const guildStaffRolesOnOpen = await listStaffRoles(guildId);
      const allModRoleIdsOnOpen = [...new Set([...ss.modRoleIds, ...guildStaffRolesOnOpen.map((r) => r.roleId)])];
      for (const roleId of allModRoleIdsOnOpen) {
        permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      }

      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parent,
        permissionOverwrites,
        reason: `Shop ticket for ${interaction.user.tag}`,
      }).catch(() => null);

      if (!ticketChannel) {
        await submit.reply({ content: "Failed to create your ticket channel. Please contact an admin.", flags: 1 << 6 });
        return true;
      }

      const ticket: ShopTicket = {
        ticketId,
        shopId,
        shopName: shop.name,
        guildId,
        userId: interaction.user.id,
        channelId: ticketChannel.id,
        allowedViewers: [],
        answers,
        status: "open",
        createdAt: Date.now(),
      };
      await saveTicket(ticket);

      // Post opening message in ticket
      const openEmbed = new EmbedBuilder()
        .setTitle(`${CE.shoppingcart.str} Ticket — ${shop.name}`)
        .setDescription(`Welcome, <@${interaction.user.id}>! A staff member will be with you shortly.\n\nPlease review your answers below.`)
        .setColor(COLORS.primary)
        .addFields(
          questions.slice(0, answers.length).map((q, i) => ({ name: q, value: answers[i] || "—", inline: false })),
        )
        .setFooter({ text: `Ticket ID: ${ticketId}` })
        .setTimestamp();

      await ticketChannel.send({
        content: `<@${interaction.user.id}> ${allModRoleIdsOnOpen.map((r) => `<@&${r}>`).join(" ")}`,
        embeds: [openEmbed],
        components: [ticketControlRow(guildId, ticketId, false)],
      });

      if (ss.logChannelId) {
        const logCh = guild.channels.cache.get(ss.logChannelId) as TextChannel | null;
        logCh?.send({ embeds: [prettyEmbed({ title: `${CE.shoppingcart.str} New Ticket Opened`, color: COLORS.info, fields: [{ name: "Ticket", value: ticketId, inline: true }, { name: "Shop", value: shop.name, inline: true }, { name: "Customer", value: `<@${interaction.user.id}>`, inline: true }] })] }).catch(() => {});
      }

      await submit.reply({ content: `${CE.success.str} Your ticket has been created: <#${ticketChannel.id}>`, flags: 1 << 6 });
      return true;
    }

    // ── Claim ─────────────────────────────────────────────────────────────────
    if (action === "claim") {
      const guildId = parts[2];
      const ticketId = parts[3];
      if (!interaction.isButton() || !interaction.inGuild()) return true;

      const guild = interaction.guild ?? await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return true;

      const ticket = await getTicketById(ticketId);
      if (!ticket || ticket.status === "closed") {
        await interaction.reply({ content: "This ticket is already closed or not found.", flags: 1 << 6 });
        return true;
      }
      if (ticket.claimedBy) {
        await interaction.reply({ content: `This ticket has already been claimed by <@${ticket.claimedBy}>.`, flags: 1 << 6 });
        return true;
      }

      const ss = await getShopSettings(guildId);
      const guildStaffRoles = await listStaffRoles(guildId);
      const guildStaffRoleIds = guildStaffRoles.map((r) => r.roleId);
      const allModRoleIds = [...new Set([...ss.modRoleIds, ...guildStaffRoleIds])];
      const isStaff = allModRoleIds.some((r) => interaction.member?.roles && (interaction.member.roles as any).cache?.has(r))
        || ss.adminRoleIds.some((r) => interaction.member?.roles && (interaction.member.roles as any).cache?.has(r));

      if (!isStaff) {
        await interaction.reply({ content: "Only shop staff can claim tickets.", flags: 1 << 6 });
        return true;
      }

      // Lock channel — remove mod role access, only claimer + admin roles + opener
      const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | null;
      if (channel) {
        await channel.permissionOverwrites.set([
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: ticket.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
          ...ss.adminRoleIds.map((r) => ({ id: r, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] as bigint[] })),
        ]);
      }

      await updateTicket(ticket.channelId, (t) => ({ ...t, claimedBy: interaction.user.id, status: "claimed" }));

      await interaction.update({
        components: [ticketControlRow(guildId, ticketId, true)],
      });
      await interaction.followUp({ content: `${CE.success.str} **<@${interaction.user.id}>** has claimed this ticket. Other staff can no longer see it.` });
      return true;
    }

    // ── Pre-Close (shows outcome picker) ─────────────────────────────────────
    if (action === "precl") {
      const guildId = parts[2];
      const ticketId = parts[3];
      if (!interaction.isButton() || !interaction.inGuild()) return true;

      const ticket = await getTicketById(ticketId);
      if (!ticket || ticket.status === "closed") {
        await interaction.reply({ content: "This ticket is already closed.", flags: 1 << 6 });
        return true;
      }

      const ss = await getShopSettings(guildId);
      const guildStaffRolesPrecl = await listStaffRoles(guildId);
      const allModRoleIdsPrecl = [...new Set([...ss.modRoleIds, ...guildStaffRolesPrecl.map((r) => r.roleId)])];
      const isStaff = allModRoleIdsPrecl.some((r) => (interaction.member?.roles as any)?.cache?.has(r))
        || ss.adminRoleIds.some((r) => (interaction.member?.roles as any)?.cache?.has(r));
      const isClaimer = ticket.claimedBy === interaction.user.id;

      if (!isStaff && !isClaimer) {
        await interaction.reply({ content: "Only shop staff can close tickets.", flags: 1 << 6 });
        return true;
      }

      await interaction.update({
        embeds: [new EmbedBuilder().setTitle(`${CE.shoppingcart.str} Close Ticket`).setDescription("Select the outcome for this ticket:").setColor(COLORS.warning)],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`shop:outcome:s:${guildId}:${ticketId}`)
              .setLabel("Service Successful")
              .setStyle(ButtonStyle.Success)
              .setEmoji(CE.cash.str),
            new ButtonBuilder()
              .setCustomId(`shop:outcome:f:${guildId}:${ticketId}`)
              .setLabel("Unsuccessful")
              .setStyle(ButtonStyle.Danger)
              .setEmoji(CE.discount.str),
            new ButtonBuilder()
              .setCustomId(`shop:claim:${guildId}:${ticketId}`)
              .setLabel("← Cancel")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
      return true;
    }

    // ── Outcome: Success ──────────────────────────────────────────────────────
    if (action === "outcome" && parts[2] === "s") {
      const guildId = parts[3];
      const ticketId = parts[4];
      if (!interaction.isButton()) return true;

      const ticket = await getTicketById(ticketId);
      if (!ticket) { await interaction.reply({ content: "Ticket not found.", flags: 1 << 6 }); return true; }

      const modal = new ModalBuilder()
        .setCustomId(`shop:closeModal:${guildId}:${ticketId}`)
        .setTitle("Service Details");
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("item")
            .setLabel("What was purchased?")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(200),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("price")
            .setLabel("At what price?")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100),
        ),
      );
      await interaction.showModal(modal);

      let submit;
      try {
        submit = await interaction.awaitModalSubmit({
          filter: (s) => s.customId === `shop:closeModal:${guildId}:${ticketId}` && s.user.id === interaction.user.id,
          time: 10 * 60 * 1000,
        });
      } catch { return true; }

      const item = submit.fields.getTextInputValue("item").trim();
      const price = submit.fields.getTextInputValue("price").trim();

      if (submit.isFromMessage()) {
        await submit.update({ content: `${CE.loading.str} Closing ticket...`, embeds: [], components: [] }).catch(() => {});
      } else {
        await submit.deferUpdate().catch(() => {});
      }

      await finalizeClose(client, ticket, "success", item, price);
      return true;
    }

    // ── Outcome: Failure ──────────────────────────────────────────────────────
    if (action === "outcome" && parts[2] === "f") {
      const guildId = parts[3];
      const ticketId = parts[4];
      if (!interaction.isButton()) return true;

      const ticket = await getTicketById(ticketId);
      if (!ticket) { await interaction.reply({ content: "Ticket not found.", flags: 1 << 6 }); return true; }

      await interaction.update({ content: `${CE.loading.str} Closing ticket...`, embeds: [], components: [] }).catch(() => {});
      await finalizeClose(client, ticket, "failure");
      return true;
    }

    // ── Rate ──────────────────────────────────────────────────────────────────
    if (action === "rate") {
      const ticketId = parts[2];
      const rating = parseInt(parts[3], 10);
      if (!interaction.isButton()) return true;
      if (!Number.isFinite(rating) || rating < 1 || rating > 10) return true;

      const ticket = await getTicketById(ticketId);
      if (!ticket) {
        await interaction.update({ content: "This ticket no longer exists.", components: [] });
        return true;
      }
      if (ticket.rating != null) {
        await interaction.update({ content: "You have already rated this service. Thank you!", components: [] });
        return true;
      }
      if (ticket.userId !== interaction.user.id) {
        await interaction.reply({ content: "Only the ticket opener can rate this service.", flags: 1 << 6 });
        return true;
      }

      await updateTicket(ticket.channelId, (t) => ({ ...t, rating }));

      if (ticket.claimedBy) {
        await updateStaffSale(ticket.guildId, ticket.claimedBy, ticketId, { rating });
      }

      const stars = CE.star_rating.str.repeat(rating) + (rating < 10 ? "☆".repeat(10 - rating) : "");
      await interaction.update({
        content: `Thank you for your rating!\n\n${stars} **${rating}/10**\n\nYour feedback has been recorded and will help improve our service.`,
        components: [],
      });
      return true;
    }
  } catch (err) {
    logger.error({ err, customId: id }, "[Shop] Interaction handler error");
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong. Please try again.", flags: 1 << 6 }).catch(() => {});
    }
  }

  return false;
}