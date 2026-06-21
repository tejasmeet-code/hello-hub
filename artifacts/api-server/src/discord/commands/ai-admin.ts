import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildChannel,
} from "discord.js";
import type { SlashCommand } from "../types";
import { COLORS, CE } from "../utils/embedStyle";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AdminAction {
  type: string;
  description: string;
  params: Record<string, unknown>;
}

interface AdminPlan {
  summary: string;
  warning?: string;
  actions: AdminAction[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini API call (direct REST, no SDK)
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<AdminPlan> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;

  // Prefer Lovable AI Gateway (free monthly allowance, no quota issues).
  // Falls back to direct Gemini if only GOOGLE_API_KEY is configured.
  if (lovableKey) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Lovable AI rate limit hit. Try again in a moment.");
      if (res.status === 402) throw new Error("Lovable AI credits exhausted. Add credits in your Lovable workspace.");
      throw new Error(`Lovable AI returned ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from Lovable AI");
    try {
      return JSON.parse(text) as AdminPlan;
    } catch {
      throw new Error(`Lovable AI returned invalid JSON: ${text.slice(0, 200)}`);
    }
  }

  if (!googleKey) throw new Error("Neither LOVABLE_API_KEY nor GOOGLE_API_KEY is configured");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");

  try {
    return JSON.parse(text) as AdminPlan;
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Action executor
// ─────────────────────────────────────────────────────────────────────────────

async function executeAction(
  guild: Guild,
  action: AdminAction,
): Promise<{ success: boolean; message: string }> {
  try {
    const p = action.params as Record<string, any>;

    switch (action.type) {
      // ── Channels ──────────────────────────────────────────────────────────
      case "create_channel": {
        const channelType =
          p.type === "voice" ? ChannelType.GuildVoice
          : p.type === "category" ? ChannelType.GuildCategory
          : ChannelType.GuildText;
        const ch = await guild.channels.create({
          name: String(p.name),
          type: channelType,
          topic: p.topic ? String(p.topic) : undefined,
          rateLimitPerUser: p.slowmode ? Number(p.slowmode) : 0,
          parent: p.parent_id ? String(p.parent_id) : undefined,
          reason: "Created by AI Admin",
        });
        return { success: true, message: `Created channel <#${ch.id}>` };
      }

      case "delete_channel": {
        const ch = guild.channels.cache.get(String(p.channel_id));
        if (!ch) return { success: false, message: `Channel \`${p.channel_id}\` not found` };
        const name = ch.name;
        await ch.delete(p.reason ? String(p.reason) : "Deleted by AI Admin");
        return { success: true, message: `Deleted channel \`#${name}\`` };
      }

      case "edit_channel": {
        const ch = guild.channels.cache.get(String(p.channel_id)) as GuildChannel | undefined;
        if (!ch) return { success: false, message: `Channel \`${p.channel_id}\` not found` };
        await (ch as any).edit({
          ...(p.name ? { name: String(p.name) } : {}),
          ...(p.topic !== undefined ? { topic: String(p.topic) } : {}),
          ...(p.slowmode !== undefined ? { rateLimitPerUser: Number(p.slowmode) } : {}),
        });
        return { success: true, message: `Edited channel <#${p.channel_id}>` };
      }

      case "lock_channel": {
        const ch = guild.channels.cache.get(String(p.channel_id));
        if (!ch) return { success: false, message: `Channel not found` };
        await (ch as any).permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
        return { success: true, message: `Locked <#${p.channel_id}>` };
      }

      case "unlock_channel": {
        const ch = guild.channels.cache.get(String(p.channel_id));
        if (!ch) return { success: false, message: `Channel not found` };
        await (ch as any).permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
        return { success: true, message: `Unlocked <#${p.channel_id}>` };
      }

      case "set_slowmode": {
        const ch = guild.channels.cache.get(String(p.channel_id));
        if (!ch) return { success: false, message: `Channel not found` };
        await (ch as any).setRateLimitPerUser(Number(p.seconds));
        return { success: true, message: `Set slowmode to ${p.seconds}s in <#${p.channel_id}>` };
      }

      case "set_channel_permissions": {
        const ch = guild.channels.cache.get(String(p.channel_id));
        if (!ch) return { success: false, message: `Channel not found` };
        const target =
          guild.roles.cache.get(String(p.target_id)) ??
          (await guild.members.fetch(String(p.target_id)).catch(() => null));
        if (!target) return { success: false, message: `Target \`${p.target_id}\` not found` };
        const allow: string[] = Array.isArray(p.allow) ? p.allow : [];
        const deny: string[] = Array.isArray(p.deny) ? p.deny : [];
        const overwrite: Record<string, boolean | null> = {};
        for (const perm of allow) overwrite[perm] = true;
        for (const perm of deny) overwrite[perm] = false;
        await (ch as any).permissionOverwrites.edit(target, overwrite);
        return { success: true, message: `Updated permissions in <#${p.channel_id}>` };
      }

      // ── Roles ─────────────────────────────────────────────────────────────
      case "create_role": {
        const role = await guild.roles.create({
          name: String(p.name),
          color: p.color ? (String(p.color) as any) : undefined,
          hoist: Boolean(p.hoist),
          mentionable: Boolean(p.mentionable),
          reason: "Created by AI Admin",
        });
        return { success: true, message: `Created role <@&${role.id}>` };
      }

      case "delete_role": {
        const role = guild.roles.cache.get(String(p.role_id));
        if (!role) return { success: false, message: `Role \`${p.role_id}\` not found` };
        const name = role.name;
        await role.delete(p.reason ? String(p.reason) : "Deleted by AI Admin");
        return { success: true, message: `Deleted role \`${name}\`` };
      }

      case "edit_role": {
        const role = guild.roles.cache.get(String(p.role_id));
        if (!role) return { success: false, message: `Role \`${p.role_id}\` not found` };
        await role.edit({
          ...(p.name ? { name: String(p.name) } : {}),
          ...(p.color ? { color: String(p.color) as any } : {}),
          ...(p.hoist !== undefined ? { hoist: Boolean(p.hoist) } : {}),
          ...(p.mentionable !== undefined ? { mentionable: Boolean(p.mentionable) } : {}),
        });
        return { success: true, message: `Edited role <@&${p.role_id}>` };
      }

      case "add_role": {
        const member = await guild.members.fetch(String(p.user_id)).catch(() => null);
        if (!member) return { success: false, message: `Member \`${p.user_id}\` not found` };
        await member.roles.add(String(p.role_id), p.reason ? String(p.reason) : "AI Admin");
        return { success: true, message: `Added <@&${p.role_id}> to <@${p.user_id}>` };
      }

      case "remove_role": {
        const member = await guild.members.fetch(String(p.user_id)).catch(() => null);
        if (!member) return { success: false, message: `Member \`${p.user_id}\` not found` };
        await member.roles.remove(String(p.role_id), p.reason ? String(p.reason) : "AI Admin");
        return { success: true, message: `Removed <@&${p.role_id}> from <@${p.user_id}>` };
      }

      // ── Moderation ────────────────────────────────────────────────────────
      case "kick_member": {
        const member = await guild.members.fetch(String(p.user_id)).catch(() => null);
        if (!member) return { success: false, message: `Member \`${p.user_id}\` not found` };
        if (!member.kickable) return { success: false, message: `Cannot kick <@${p.user_id}> (higher role or missing perms)` };
        await member.kick(p.reason ? String(p.reason) : "Kicked by AI Admin");
        return { success: true, message: `Kicked <@${p.user_id}>` };
      }

      case "ban_member": {
        const member = await guild.members.fetch(String(p.user_id)).catch(() => null);
        if (member && !member.bannable) return { success: false, message: `Cannot ban <@${p.user_id}> (higher role or missing perms)` };
        await guild.members.ban(String(p.user_id), { reason: p.reason ? String(p.reason) : "Banned by AI Admin" });
        return { success: true, message: `Banned <@${p.user_id}>` };
      }

      case "timeout_member": {
        const member = await guild.members.fetch(String(p.user_id)).catch(() => null);
        if (!member) return { success: false, message: `Member \`${p.user_id}\` not found` };
        const ms = Number(p.duration_minutes) * 60 * 1000;
        await member.timeout(ms, p.reason ? String(p.reason) : "Timed out by AI Admin");
        return { success: true, message: `Timed out <@${p.user_id}> for ${p.duration_minutes}m` };
      }

      // ── Messaging ─────────────────────────────────────────────────────────
      case "send_message": {
        const ch = guild.channels.cache.get(String(p.channel_id));
        if (!ch || !ch.isTextBased()) return { success: false, message: `Channel not found or not text-based` };
        await (ch as any).send(String(p.content));
        return { success: true, message: `Sent message in <#${p.channel_id}>` };
      }

      default:
        return { success: false, message: `Unknown action: \`${action.type}\`` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[ai-admin] Action failed:", action.type, msg);
    return { success: false, message: `Error: ${msg.slice(0, 120)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command definition
// ─────────────────────────────────────────────────────────────────────────────

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ai-admin")
    .setDescription("Use AI to perform server admin tasks — shows a plan before executing anything.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName("instruction")
        .setDescription("What should the bot do? e.g. 'Create a #mod-logs channel visible only to staff'")
        .setRequired(true)
        .setMaxLength(1000),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;
    const guild = interaction.guild;

    await interaction.deferReply();

    const instruction = interaction.options.getString("instruction", true);

    const channelCtx = [...guild.channels.cache.values()]
      .slice(0, 60)
      .map((c) => `${c.name} (id:${c.id}, type:${ChannelType[c.type]})`)
      .join(", ");

    const roleCtx = [...guild.roles.cache.values()]
      .filter((r) => r.name !== "@everyone")
      .slice(0, 30)
      .map((r) => `${r.name} (id:${r.id})`)
      .join(", ");

    const systemPrompt = `You are an AI assistant helping a Discord server administrator.
Given a natural language instruction, output a structured plan of safe Discord actions.

SERVER CONTEXT:
- Name: "${guild.name}" (${guild.memberCount} members)
- Channels: ${channelCtx || "(none)"}
- Roles: ${roleCtx || "(none)"}

RULES:
- NEVER include more than 1 ban or kick action per plan
- NEVER delete more than 3 channels or roles at once
- NEVER generate a plan that nukes, wipes, or mass-removes server content
- If the request is dangerous or unclear, return an empty actions array with an explanation in summary
- When referencing existing channels/roles, use their actual IDs from the context above
- When creating new channels/roles, omit the ID fields

AVAILABLE ACTIONS:
create_channel   → { name, type: "text"|"voice"|"category", topic?, slowmode?, parent_id? }
delete_channel   → { channel_id, reason? }
edit_channel     → { channel_id, name?, topic?, slowmode? }
lock_channel     → { channel_id }
unlock_channel   → { channel_id }
set_slowmode     → { channel_id, seconds }
set_channel_permissions → { channel_id, target_id, allow?: string[], deny?: string[] }
create_role      → { name, color?, hoist?, mentionable? }
delete_role      → { role_id, reason? }
edit_role        → { role_id, name?, color?, hoist?, mentionable? }
add_role         → { user_id, role_id, reason? }
remove_role      → { user_id, role_id, reason? }
kick_member      → { user_id, reason? }
ban_member       → { user_id, reason? }
timeout_member   → { user_id, duration_minutes, reason? }
send_message     → { channel_id, content }

OUTPUT FORMAT (JSON only, no markdown):
{
  "summary": "Short 1-2 sentence description of what will happen",
  "warning": "Only include if steps are destructive or irreversible",
  "actions": [
    { "type": "action_type", "description": "Human-readable step description", "params": {} }
  ]
}

USER INSTRUCTION: "${instruction}"`;

    let plan: AdminPlan;
    try {
      plan = await callGemini(systemPrompt);
    } catch (err) {
      console.error("[ai-admin] Gemini call failed:", err);
      await interaction.editReply({
        content: `${CE.error.str} **AI request failed.** Make sure \`GOOGLE_API_KEY\` is set.\n\`${err instanceof Error ? err.message : String(err)}\``,
      });
      return;
    }

    if (!Array.isArray(plan.actions) || plan.actions.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${CE.settings.str} AI Admin — No Plan Generated`)
            .setDescription(`**Your request:** ${instruction}\n\n**AI response:** ${plan.summary}`)
            .setColor(COLORS.warning),
        ],
      });
      return;
    }

    const stepList = plan.actions
      .map((a, i) => `\`${i + 1}.\` ${a.description}`)
      .join("\n");

    const planEmbed = new EmbedBuilder()
      .setTitle(`${CE.settings.str} AI Admin — Review Plan`)
      .setDescription(`**Your request:** ${instruction}\n\n${plan.summary}`)
      .addFields({ name: `${plan.actions.length} step${plan.actions.length === 1 ? "" : "s"}`, value: stepList })
      .setColor(plan.warning ? COLORS.warning : COLORS.info)
      .setFooter({ text: "You have 2 minutes to confirm or cancel." })
      .setTimestamp();

    if (plan.warning) {
      planEmbed.addFields({ name: `${CE.warning.str} Warning`, value: plan.warning });
    }

    const confirmId = `aiadmin:ok:${interaction.id}`;
    const cancelId  = `aiadmin:no:${interaction.id}`;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel(`${CE.success.str} Execute`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(cancelId).setLabel(`${CE.error.str} Cancel`).setStyle(ButtonStyle.Danger),
    );

    await interaction.editReply({ embeds: [planEmbed], components: [row] });

    let btn;
    try {
      const reply = await interaction.fetchReply();
      btn = await reply.awaitMessageComponent({
        filter: (i) =>
          (i.customId === confirmId || i.customId === cancelId) &&
          i.user.id === interaction.user.id,
        time: 120_000,
      });
    } catch {
      await interaction.editReply({
        embeds: [planEmbed.setColor(COLORS.neutral).setFooter({ text: "Timed out — plan cancelled." })],
        components: [],
      });
      return;
    }

    if (btn.customId === cancelId) {
      await btn.update({
        embeds: [planEmbed.setColor(COLORS.neutral).setFooter({ text: `Cancelled by ${interaction.user.tag}` })],
        components: [],
      });
      return;
    }

    await btn.update({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${CE.settings.str} AI Admin — Executing...`)
          .setDescription(`${CE.loading.str} Running ${plan.actions.length} step${plan.actions.length === 1 ? "" : "s"}…`)
          .setColor(COLORS.info),
      ],
      components: [],
    });

    const results: { ok: boolean; msg: string }[] = [];
    for (const action of plan.actions) {
      const r = await executeAction(guild, action);
      results.push({ ok: r.success, msg: r.message });
    }

    const allOk = results.every((r) => r.ok);
    const resultLines = results
      .map((r) => `${r.ok ? CE.success.str : CE.error.str} ${r.msg}`)
      .join("\n");

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${CE.settings.str} AI Admin — Done`)
          .setDescription(`**Request:** ${instruction}\n\n${resultLines}`)
          .setColor(allOk ? COLORS.success : COLORS.warning)
          .setFooter({ text: `Executed by ${interaction.user.tag}` })
          .setTimestamp(),
      ],
      components: [],
    });
  },
};

export default command;
