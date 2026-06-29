import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getGuildConfig } from "../storage/config";
import { CE, prettyEmbed, COLORS, errorEmbed } from "../utils/embedStyle";
import { logger } from "../../lib/logger";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

async function checkIsManager(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guildId) return false;
  if (interaction.guild?.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const cfg = await getGuildConfig(interaction.guildId);
  if (cfg.managers.userIds.includes(interaction.user.id)) return true;
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  if (member && cfg.managers.roleIds.some((r) => member.roles.cache.has(r))) return true;
  return false;
}

async function applyAvatar(
  interaction: ChatInputCommandInteraction,
  imageUrl: string,
  label: string,
): Promise<void> {
  await interaction.deferReply();

  const res = await fetch(imageUrl).catch(() => null);
  if (!res || !res.ok) {
    await interaction.editReply({
      embeds: [errorEmbed("Download failed", `Could not download the image (HTTP ${res?.status ?? "error"}). Make sure the URL is publicly accessible.`)],
    });
    return;
  }

  const ct = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_MIME.has(ct)) {
    await interaction.editReply({
      embeds: [errorEmbed("Invalid file type", `That file type (\`${ct || "unknown"}\`) isn't supported. Please use PNG, JPG, GIF, or WebP.`)],
    });
    return;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const dataUri = `data:${ct};base64,${buf.toString("base64")}`;

  try {
    await interaction.client.user?.edit({ avatar: dataUri });
  } catch (err: any) {
    logger.warn({ err }, "setavatar: failed to update avatar");
    const msg: string = err?.message ?? "";
    if (/too fast|rate.?limit/i.test(msg)) {
      await interaction.editReply({
        embeds: [errorEmbed("Rate limited", "Discord only allows **2 avatar changes per hour**. Please try again later.")],
      });
    } else {
      await interaction.editReply({
        embeds: [errorEmbed("Update failed", `Discord rejected the change: ${msg || "Unknown error"}`)],
      });
    }
    return;
  }

  const newAvatarUrl = interaction.client.user?.displayAvatarURL({ size: 512 }) ?? imageUrl;

  await interaction.editReply({
    embeds: [prettyEmbed({
      title: `${CE.success.str} Avatar Updated`,
      description: `The bot's avatar has been updated globally — it now appears everywhere.\n\n**Source:** ${label}`,
      color: COLORS.success,
      image: newAvatarUrl,
      footer: "Relosta Bot • avatar changes apply to all servers",
    })],
  });

  logger.info({ guildId: interaction.guildId, userId: interaction.user.id }, "setavatar: avatar updated");
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("setavatar")
    .setDescription("Update the bot's profile picture (global — applies to all servers).")
    .addAttachmentOption((o) =>
      o
        .setName("image")
        .setDescription("Upload an image file directly (PNG, JPG, GIF, WebP)")
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("url")
        .setDescription("Or paste a direct image URL instead of uploading")
        .setRequired(false)
        .setMaxLength(512),
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: 1 << 6 });
      return;
    }

    if (!(await checkIsManager(interaction))) {
      await interaction.reply({
        embeds: [errorEmbed("No permission", "Only server managers and bot administrators can change the bot's avatar.")],
        flags: 1 << 6,
      });
      return;
    }

    const attachment = interaction.options.getAttachment("image");
    const urlOpt = interaction.options.getString("url")?.trim();

    if (!attachment && !urlOpt) {
      await interaction.reply({
        embeds: [errorEmbed("Nothing provided", "Provide either an `image` attachment or a `url`. Example:\n`/setavatar image:<file>`")],
        flags: 1 << 6,
      });
      return;
    }

    if (attachment) {
      const ct = (attachment.contentType ?? "").split(";")[0]!.trim().toLowerCase();
      if (ct && !ALLOWED_MIME.has(ct)) {
        await interaction.reply({
          embeds: [errorEmbed("Invalid file type", `That attachment (\`${ct}\`) isn't a supported image. Please upload PNG, JPG, GIF, or WebP.`)],
          flags: 1 << 6,
        });
        return;
      }
      await applyAvatar(interaction, attachment.url, `Uploaded file — ${attachment.name}`);
    } else {
      await applyAvatar(interaction, urlOpt!, urlOpt!);
    }
  },
};

export default command;