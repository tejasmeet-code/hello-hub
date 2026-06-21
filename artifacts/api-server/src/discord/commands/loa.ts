import {
  ChannelType,
  type GuildTextBasedChannel,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { ensureWhitelisted } from "../utils/gate";
import { isManager } from "../utils/staffPerms";
import { prettyEmbed, buildBullets, COLORS, CE, errorEmbed, successEmbed, infoEmbed } from "../utils/embedStyle";
import { getGuildConfig, getLoaConfig } from "../storage/config";
import {
  createLOA,
  getLOAsForGuild,
  getLOAsForUser,
  getActiveLOAForUser,
  getPendingLOAForUser,
  updateLOAStatus,
  endLOA,
  type LOAStatus,
} from "../storage/loa";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("loa")
    .setDescription("Leave of Absence management.")
    .addSubcommand(sub => sub
      .setName("request")
      .setDescription("Submit a leave of absence request.")
      // reason is optional here — enforced at runtime based on guild config
      .addStringOption(o => o.setName("reason").setDescription("Why are you going on LOA?").setRequired(false).setMaxLength(500))
      .addStringOption(o => o.setName("return_date").setDescription("Expected return date (e.g. May 10)").setRequired(false).setMaxLength(50))
    )
    .addSubcommand(sub => sub
      .setName("list")
      .setDescription("List LOA requests.")
      .addStringOption(o => o.setName("status").setDescription("Filter by status").setRequired(false).addChoices(
        { name: "Pending",  value: "pending" },
        { name: "Approved", value: "approved" },
        { name: "Denied",   value: "denied" },
        { name: "Ended",    value: "ended" },
        { name: "All",      value: "all" },
      ))
    )
    .addSubcommand(sub => sub
      .setName("approve")
      .setDescription("Approve a pending LOA request.")
      .addUserOption(o => o.setName("user").setDescription("User whose LOA to approve").setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName("deny")
      .setDescription("Deny a pending LOA request.")
      .addUserOption(o => o.setName("user").setDescription("User whose LOA to deny").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason for denial").setRequired(false).setMaxLength(256))
    )
    .addSubcommand(sub => sub
      .setName("end")
      .setDescription("End your active leave of absence and mark yourself as returned.")
    )
    .addSubcommand(sub => sub
      .setName("history")
      .setDescription("View the full LOA history for yourself or another staff member.")
      .addUserOption(o => o.setName("user").setDescription("Staff member to look up (managers only — defaults to you)").setRequired(false))
      .addIntegerOption(o => o.setName("page").setDescription("Page number (10 entries per page)").setRequired(false).setMinValue(1))
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "loa"))) return;
    if (!interaction.guild || !interaction.guildId) return;

    await interaction.deferReply({ flags: 1 << 6 });

    const sub = interaction.options.getSubcommand();
    const cfg = await getGuildConfig(interaction.guildId);
    const loaCfg = getLoaConfig(cfg);

    // ── /loa request ──────────────────────────────────────────────────────────
    if (sub === "request") {
      const reason = interaction.options.getString("reason")?.trim() ?? null;
      const returnDate = interaction.options.getString("return_date")?.trim() ?? null;

      // Enforce requireReason config setting
      if (loaCfg.requireReason && !reason) {
        await interaction.editReply({
          embeds: [errorEmbed(
            "Reason required",
            "This server requires a reason when submitting an LOA request. Please provide one using the `reason` option.",
          )],
        });
        return;
      }

      const finalReason = reason ?? "No reason provided";

      // Enforce maxDurationDays if set and a return date was provided
      if (loaCfg.maxDurationDays > 0 && returnDate) {
        const parsed = new Date(returnDate);
        if (!isNaN(parsed.getTime())) {
          const maxMs = loaCfg.maxDurationDays * 24 * 60 * 60 * 1000;
          if (parsed.getTime() - Date.now() > maxMs) {
            await interaction.editReply({
              embeds: [errorEmbed(
                "Return date too far",
                `This server has a maximum LOA duration of **${loaCfg.maxDurationDays} days**. Your return date exceeds this limit.`,
              )],
            });
            return;
          }
        }
      }

      const existing = await getPendingLOAForUser(interaction.guildId, interaction.user.id);
      if (existing) {
        await interaction.editReply({ embeds: [errorEmbed("Already pending", "You already have a pending LOA request. Wait for it to be reviewed.")] });
        return;
      }
      const active = await getActiveLOAForUser(interaction.guildId, interaction.user.id);
      if (active) {
        await interaction.editReply({ embeds: [errorEmbed("Already on LOA", "You're already on an approved LOA. Use `/loa end` to return.")] });
        return;
      }

      const loa = await createLOA(interaction.guildId, interaction.user.id, finalReason, returnDate);

      const requestEmbed = prettyEmbed({
        title: "Leave of Absence Request",
        description: `${CE.information.str}\n\n${buildBullets([
          { label: "Staff Member", value: `<@${interaction.user.id}> — ${interaction.user.tag}` },
          { label: "Reason",       value: finalReason },
          ...(returnDate ? [{ label: "Return Date", value: returnDate }] : []),
          { label: "Status",       value: `${CE.loading.str} Pending review` },
          { label: "LOA ID",       value: `\`${loa.id}\`` },
        ])}`,
        thumbnail: interaction.user.displayAvatarURL({ size: 256 }),
        color: COLORS.warning,
        footer: `Submitted • Relosta Bot`,
      });

      // Reply to the staff member
      await interaction.editReply({
        embeds: [prettyEmbed({
          title: "LOA request submitted",
          description: `${CE.success.str}\n\n${buildBullets([
            { label: "Server",     value: interaction.guild.name },
            { label: "Reason",     value: finalReason },
            ...(returnDate ? [{ label: "Return Date", value: returnDate }] : []),
            { label: "Status",     value: "Pending — awaiting manager review" },
          ])}`,
          color: COLORS.info,
          footer: "You'll be notified when it's reviewed • Relosta Bot",
        })],
      });

      // DM the submitter confirming submission
      interaction.user.send({
        embeds: [prettyEmbed({
          title: "LOA Request Submitted",
          description: `${CE.information.str}\n\n${buildBullets([
            { label: "Server",      value: interaction.guild.name },
            { label: "Reason",      value: finalReason },
            ...(returnDate ? [{ label: "Return Date", value: returnDate }] : []),
            { label: "Status",      value: "Pending — awaiting manager review" },
          ])}`,
          color: COLORS.info,
          footer: "You'll be DM'd again when a manager reviews it • Relosta Bot",
        })],
      }).catch(() => {});

      // Post to LOA log channel
      const loaChannelId = cfg.channels.loaLog;
      if (loaChannelId) {
        const ch = await interaction.guild.channels.fetch(loaChannelId).catch(() => null);
        if (ch && ch.type === ChannelType.GuildText) {
          await (ch as GuildTextBasedChannel).send({ embeds: [requestEmbed] }).catch(() => {});
        }
      }

    // ── /loa list ─────────────────────────────────────────────────────────────
    } else if (sub === "list") {
      const statusFilter = interaction.options.getString("status") ?? "pending";
      const loas = await getLOAsForGuild(
        interaction.guildId,
        statusFilter === "all" ? undefined : statusFilter as LOAStatus,
      );

      if (loas.length === 0) {
        await interaction.editReply({
          embeds: [infoEmbed("No LOAs", `No ${statusFilter === "all" ? "" : statusFilter + " "}LOA requests found.`)],
        });
        return;
      }

      const statusEmoji = (s: string) => {
        if (s === "approved") return CE.success.str;
        if (s === "denied")   return CE.error.str;
        if (s === "ended")    return CE.information.str;
        return CE.loading.str;
      };

      const lines = loas.slice(0, 20).map(r => {
        const truncated = r.reason.slice(0, 60) + (r.reason.length > 60 ? "…" : "");
        return `• ${statusEmoji(r.status)} <@${r.userId}> — ${truncated}${r.returnDate ? ` *(returns ${r.returnDate})*` : ""}`;
      });

      await interaction.editReply({
        embeds: [prettyEmbed({
          title: `LOA Requests — ${statusFilter === "all" ? "All" : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}`,
          description: lines.join("\n"),
          color: COLORS.info,
          footer: `${loas.length} total • Relosta Bot`,
        })],
      });

    // ── /loa approve ──────────────────────────────────────────────────────────
    } else if (sub === "approve") {
      const target = interaction.options.getUser("user", true);
      const pending = await getPendingLOAForUser(interaction.guildId, target.id);
      if (!pending) {
        await interaction.editReply({ embeds: [errorEmbed("No pending LOA", `**${target.tag}** has no pending LOA request.`)] });
        return;
      }

      await updateLOAStatus(interaction.guildId, pending.id, "approved", interaction.user.tag);

      await interaction.editReply({
        embeds: [prettyEmbed({
          title: "LOA approved",
          description: `${CE.success.str}\n\n${buildBullets([
            { label: "Staff Member", value: `<@${target.id}> — ${target.tag}` },
            { label: "Reason",       value: pending.reason },
            ...(pending.returnDate ? [{ label: "Return Date", value: pending.returnDate }] : []),
            { label: "Approved by",  value: `<@${interaction.user.id}>` },
          ])}`,
          thumbnail: target.displayAvatarURL({ size: 256 }),
          color: COLORS.success,
          footer: "Relosta Bot",
        })],
      });

      // DM the staff member about approval
      target.send({
        embeds: [prettyEmbed({
          title: "Your LOA has been approved",
          description: `${CE.success.str}\n\n${buildBullets([
            { label: "Server",      value: interaction.guild.name },
            { label: "Approved by", value: `${interaction.user.tag}` },
            { label: "Reason",      value: pending.reason },
            ...(pending.returnDate ? [{ label: "Return Date", value: pending.returnDate }] : []),
          ])}`,
          color: COLORS.success,
          footer: "Use /loa end when you return • Relosta Bot",
        })],
      }).catch(() => {});

      // Post update to LOA log channel
      const loaChannelId = cfg.channels.loaLog;
      if (loaChannelId) {
        const ch = await interaction.guild.channels.fetch(loaChannelId).catch(() => null);
        if (ch && ch.type === ChannelType.GuildText) {
          await (ch as GuildTextBasedChannel).send({
            embeds: [prettyEmbed({
              title: "LOA Approved",
              description: buildBullets([
                { label: "Staff Member", value: `<@${target.id}> — ${target.tag}` },
                { label: "Reason",       value: pending.reason },
                ...(pending.returnDate ? [{ label: "Return Date", value: pending.returnDate }] : []),
                { label: "Approved by",  value: `<@${interaction.user.id}>` },
              ]),
              thumbnail: target.displayAvatarURL({ size: 256 }),
              color: COLORS.success,
              footer: "Relosta Bot",
            })],
          }).catch(() => {});
        }
      }

    // ── /loa deny ─────────────────────────────────────────────────────────────
    } else if (sub === "deny") {
      const target = interaction.options.getUser("user", true);
      const denyReason = interaction.options.getString("reason")?.trim() ?? "No reason provided";
      const pending = await getPendingLOAForUser(interaction.guildId, target.id);
      if (!pending) {
        await interaction.editReply({ embeds: [errorEmbed("No pending LOA", `**${target.tag}** has no pending LOA request.`)] });
        return;
      }

      await updateLOAStatus(interaction.guildId, pending.id, "denied", interaction.user.tag);

      await interaction.editReply({
        embeds: [prettyEmbed({
          title: "LOA denied",
          description: `${CE.error.str}\n\n${buildBullets([
            { label: "Staff Member", value: `<@${target.id}> — ${target.tag}` },
            { label: "Denied by",    value: `<@${interaction.user.id}>` },
            { label: "Reason",       value: denyReason },
          ])}`,
          thumbnail: target.displayAvatarURL({ size: 256 }),
          color: COLORS.danger,
          footer: "Relosta Bot",
        })],
      });

      // DM the staff member about denial
      target.send({
        embeds: [prettyEmbed({
          title: "Your LOA request was denied",
          description: `${CE.error.str}\n\n${buildBullets([
            { label: "Server",    value: interaction.guild.name },
            { label: "Denied by", value: `${interaction.user.tag}` },
            { label: "Reason",    value: denyReason },
          ])}`,
          color: COLORS.danger,
          footer: "You may submit a new request if circumstances change • Relosta Bot",
        })],
      }).catch(() => {});

      // Post update to LOA log channel
      const loaChannelId = cfg.channels.loaLog;
      if (loaChannelId) {
        const ch = await interaction.guild.channels.fetch(loaChannelId).catch(() => null);
        if (ch && ch.type === ChannelType.GuildText) {
          await (ch as GuildTextBasedChannel).send({
            embeds: [prettyEmbed({
              title: "LOA Denied",
              description: buildBullets([
                { label: "Staff Member", value: `<@${target.id}> — ${target.tag}` },
                { label: "Denied by",    value: `<@${interaction.user.id}>` },
                { label: "Reason",       value: denyReason },
              ]),
              thumbnail: target.displayAvatarURL({ size: 256 }),
              color: COLORS.danger,
              footer: "Relosta Bot",
            })],
          }).catch(() => {});
        }
      }

    // ── /loa end ──────────────────────────────────────────────────────────────
    } else if (sub === "end") {
      const ended = await endLOA(interaction.guildId, interaction.user.id);
      if (!ended) {
        await interaction.editReply({ embeds: [errorEmbed("No active LOA", "You don't have an active approved LOA.")] });
        return;
      }

      await interaction.editReply({
        embeds: [successEmbed("Welcome back!", `Your LOA has been marked as ended. Good to have you back, <@${interaction.user.id}>!`)],
      });

      // DM the user confirming their LOA is over
      interaction.user.send({
        embeds: [prettyEmbed({
          title: "Your LOA has ended",
          description: `${CE.success.str}\n\n${buildBullets([
            { label: "Server",   value: interaction.guild.name },
            { label: "Status",   value: "Returned — LOA marked as ended" },
            ...(ended.returnDate ? [{ label: "Planned return", value: ended.returnDate }] : []),
          ])}`,
          color: COLORS.success,
          footer: "Welcome back! • Relosta Bot",
        })],
      }).catch(() => {});

      // Post to LOA log channel
      const loaChannelId = cfg.channels.loaLog;
      if (loaChannelId) {
        const ch = await interaction.guild.channels.fetch(loaChannelId).catch(() => null);
        if (ch && ch.type === ChannelType.GuildText) {
          await (ch as GuildTextBasedChannel).send({
            embeds: [prettyEmbed({
              title: "Staff Member Returned from LOA",
              description: buildBullets([
                { label: "Staff Member", value: `<@${interaction.user.id}> — ${interaction.user.tag}` },
                { label: "Original Reason", value: ended.reason },
                ...(ended.returnDate ? [{ label: "Planned Return Date", value: ended.returnDate }] : []),
                { label: "Status", value: "Returned" },
              ]),
              thumbnail: interaction.user.displayAvatarURL({ size: 256 }),
              color: COLORS.success,
              footer: "Relosta Bot",
            })],
          }).catch(() => {});
        }
      }

    // ── /loa history ──────────────────────────────────────────────────────────
    } else if (sub === "history") {
      const targetUser = interaction.options.getUser("user");
      const page = Math.max(1, interaction.options.getInteger("page") ?? 1);
      const PER_PAGE = 10;

      // Non-managers can only view their own history
      const managerCheck = await isManager(interaction);
      if (targetUser && targetUser.id !== interaction.user.id && !managerCheck) {
        await interaction.editReply({
          embeds: [errorEmbed("Permission denied", "You can only view your own LOA history. Managers can look up any staff member.")],
        });
        return;
      }

      const subject = targetUser ?? interaction.user;
      const all = await getLOAsForUser(interaction.guildId, subject.id);

      if (all.length === 0) {
        await interaction.editReply({
          embeds: [infoEmbed(
            `LOA History — ${subject.tag}`,
            `${CE.information.str} No LOA records found for <@${subject.id}>.`,
          )],
        });
        return;
      }

      const totalPages = Math.ceil(all.length / PER_PAGE);
      const clampedPage = Math.min(page, totalPages);
      const slice = all.slice((clampedPage - 1) * PER_PAGE, clampedPage * PER_PAGE);

      // Status emoji + label helpers
      const statusEmoji = (s: string) => {
        if (s === "approved") return CE.success.str;
        if (s === "denied")   return CE.error.str;
        if (s === "ended")    return CE.information.str;
        return CE.loading.str;
      };
      const statusLabel = (s: string) =>
        s.charAt(0).toUpperCase() + s.slice(1);

      // Build one embed field per LOA entry
      const fields = slice.map((r, idx) => {
        const num = (clampedPage - 1) * PER_PAGE + idx + 1;
        const lines: string[] = [
          `• **Reason:** ${r.reason.slice(0, 120)}${r.reason.length > 120 ? "…" : ""}`,
          `• **Requested:** <t:${Math.floor(r.requestedAt / 1000)}:D>`,
        ];
        if (r.returnDate) lines.push(`• **Return date:** ${r.returnDate}`);
        if (r.reviewedBy) lines.push(`• **Reviewed by:** ${r.reviewedBy} — <t:${Math.floor((r.reviewedAt ?? r.requestedAt) / 1000)}:D>`);
        if (r.endedAt)    lines.push(`• **Ended:** <t:${Math.floor(r.endedAt / 1000)}:D>`);

        return {
          name: `${statusEmoji(r.status)} #${num} — ${statusLabel(r.status)}`,
          value: lines.join("\n"),
          inline: false,
        };
      });

      // Summary counts
      const counts = { approved: 0, denied: 0, ended: 0, pending: 0 };
      for (const r of all) counts[r.status as keyof typeof counts]++;
      const summary =
        `${CE.success.str} ${counts.approved + counts.ended} approved  •  ` +
        `${CE.error.str} ${counts.denied} denied  •  ` +
        `${CE.loading.str} ${counts.pending} pending`;

      await interaction.editReply({
        embeds: [prettyEmbed({
          title: `LOA History — ${subject.tag}`,
          description: `${summary}\n\n**${all.length}** total record${all.length !== 1 ? "s" : ""}`,
          thumbnail: subject.displayAvatarURL({ size: 256 }),
          color: COLORS.info,
          fields,
          footer: `Page ${clampedPage} of ${totalPages} • Relosta Bot`,
        })],
      });
    }
  },
};

export default command;