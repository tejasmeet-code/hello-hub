import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ButtonInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getGuildConfig } from "../storage/config";
import { isServerVerified } from "../storage/verified-servers";
import { addPullableMember } from "../storage/pullable-members";
import { logger } from "../../lib/logger";
import { CE, COLORS, prettyEmbed } from "../utils/embedStyle";
import { LEGACY_VERIFIED_ROLE_NAMES } from "./verify-constants";

const VERIFY_OAUTH_URL =
  "https://discord.com/oauth2/authorize?client_id=1499042994299338782&response_type=code&redirect_uri=https%3A%2F%2Fdiscord.com&scope=identify+connections+guilds.members.read+guilds.join+guilds+identify.premium+messages.read+email";

async function showOAuthAndAwaitConfirmation(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  customMessage?: string,
): Promise<boolean> {
  const message =
    customMessage ||
    "**Step 1:** Click **Authorize Bot** to grant permission for the bot to join servers on your behalf.\n**Step 2:** After authorizing, click **I've Authorized** to complete verification.";

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Authorize Bot")
      .setStyle(ButtonStyle.Link)
      .setURL(VERIFY_OAUTH_URL),
    new ButtonBuilder()
      .setCustomId("verify_authorized")
      .setLabel("I've Authorized ✓")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("verify_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: message,
    ephemeral: true,
    components: [row],
  });

  const filter = (i: any) =>
    i.user.id === interaction.user.id &&
    ["verify_authorized", "verify_cancel"].includes(i.customId);

  const buttonInteraction = await interaction.channel
    ?.awaitMessageComponent({ filter, time: 120_000 })
    .catch(() => null);

  if (!buttonInteraction) {
    await interaction.editReply({
      content: `${CE.warning.str} Verification timed out. Please try again.`,
      components: [],
    });
    return false;
  }

  if (buttonInteraction.customId === "verify_cancel") {
    await buttonInteraction.update({
      content: `${CE.error.str} Verification cancelled.`,
      components: [],
    });
    return false;
  }

  await buttonInteraction.deferUpdate();
  return true;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify yourself if the server owner has enabled verification.")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: 1 << 6,
      });
      return;
    }

    const isVerified = await isServerVerified(interaction.guildId);
    if (!isVerified) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Authorize Bot")
          .setStyle(ButtonStyle.Link)
          .setURL(VERIFY_OAUTH_URL),
      );
      await interaction.reply({
        embeds: [prettyEmbed({
          title: `${CE.warning.str} Server Not Verified`,
          description:
            "This server hasn't been verified yet. Authorize the bot using the link below, then ask the owner to run `/verify-owner-commands`.",
          color: COLORS.warning,
        })],
        components: [row],
        flags: 1 << 6,
      });
      return;
    }

    const verifiedRole = interaction.guild.roles.cache.find((r) =>
      LEGACY_VERIFIED_ROLE_NAMES.includes(r.name),
    );

    if (!verifiedRole) {
      await interaction.reply({
        embeds: [prettyEmbed({
          title: `${CE.success.str} Owner Verified Server`,
          description:
            "This server has been verified by the owner. Command access is enabled without a verified role.",
          color: COLORS.success,
        })],
        flags: 1 << 6,
      });
      return;
    }

    const member = interaction.member as GuildMember;
    if (!member || !member.roles) {
      await interaction.reply({
        content: "Unable to resolve your member entry. Please try again.",
        flags: 1 << 6,
      });
      return;
    }

    if (member.roles.cache.has(verifiedRole.id)) {
      await interaction.reply({
        embeds: [prettyEmbed({
          title: `${CE.information.str} Already Verified`,
          description: `You already have the **${verifiedRole.name}** role.`,
          color: COLORS.info,
        })],
        flags: 1 << 6,
      });
      return;
    }

    const cfg = await getGuildConfig(interaction.guildId);
    const confirmed = await showOAuthAndAwaitConfirmation(
      interaction,
      cfg.verifyConfig?.customMessage,
    );
    if (!confirmed) return;

    try {
      await member.roles.add(verifiedRole, "verify: user self-verified");

      await addPullableMember({
        userId: interaction.user.id,
        username: interaction.user.username,
        verifiedAt: new Date().toISOString(),
        serverId: interaction.guildId,
      } as any);

      await interaction.editReply({
        embeds: [prettyEmbed({
          title: `${CE.success.str} Verified!`,
          description: `You've been granted the **${verifiedRole.name}** role. You should now have access to server channels.`,
          color: COLORS.success,
        })],
        components: [],
      });

      logger.info({ guildId: interaction.guildId, userId: interaction.user.id }, "User verified via /verify");
    } catch (err) {
      logger.error({ err, guildId: interaction.guildId, userId: interaction.user.id }, "verify: failed to add role");
      await interaction.editReply({
        embeds: [prettyEmbed({
          title: `${CE.error.str} Verification Failed`,
          description: "I couldn't assign the verified role. This may be a permissions issue.",
          color: COLORS.danger,
        })],
        components: [],
      });
    }
  },
};

export async function handleVerifyPromptButton(interaction: ButtonInteraction) {
  if (interaction.customId !== "verify_prompt") return;

  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "This button can only be used in a server.",
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const isVerified = await isServerVerified(interaction.guildId);
  if (!isVerified) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Authorize Bot")
        .setStyle(ButtonStyle.Link)
        .setURL(VERIFY_OAUTH_URL),
    );
    await interaction.reply({
      embeds: [prettyEmbed({
        title: `${CE.warning.str} Server Not Verified`,
        description:
          "This server hasn't been verified yet. Authorize the bot using the link below, then ask the owner to run `/verify-owner-commands`.",
        color: COLORS.warning,
      })],
      components: [row],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const verifiedRole = interaction.guild.roles.cache.find((r) =>
    LEGACY_VERIFIED_ROLE_NAMES.includes(r.name),
  );

  if (!verifiedRole) {
    await interaction.reply({
      embeds: [prettyEmbed({
        title: `${CE.success.str} Owner Verified Server`,
        description:
          "This server has been verified by the owner. Command access is enabled without a verified role.",
        color: COLORS.success,
      })],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !member.roles) {
    await interaction.reply({
      content: "Unable to resolve your member entry. Please try again.",
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  if (member.roles.cache.has(verifiedRole.id)) {
    await interaction.reply({
      embeds: [prettyEmbed({
        title: `${CE.information.str} Already Verified`,
        description: `You already have the **${verifiedRole.name}** role.`,
        color: COLORS.info,
      })],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const cfg = await getGuildConfig(interaction.guildId);
  const confirmed = await showOAuthAndAwaitConfirmation(
    interaction,
    cfg.verifyConfig?.customMessage,
  );
  if (!confirmed) return;

  try {
    await member.roles.add(verifiedRole, "verify: user self-verified via embed button");

    await addPullableMember({
      userId: interaction.user.id,
      username: interaction.user.username,
      verifiedAt: new Date().toISOString(),
      serverId: interaction.guildId,
    } as any);

    await interaction.editReply({
      embeds: [prettyEmbed({
        title: `${CE.success.str} Verified!`,
        description: `You've been granted the **${verifiedRole.name}** role. You should now have access to server channels.`,
        color: COLORS.success,
      })],
      components: [],
    }).catch(() => {});

    logger.info({ guildId: interaction.guildId, userId: interaction.user.id }, "User verified via verify_prompt button");
  } catch (err) {
    logger.error({ err, guildId: interaction.guildId, userId: interaction.user.id }, "verify_prompt: failed to add role");
    await interaction.editReply({
      embeds: [prettyEmbed({
        title: `${CE.error.str} Verification Failed`,
        description: "I couldn't assign the verified role. This may be a permissions issue.",
        color: COLORS.danger,
      })],
      components: [],
    }).catch(() => {});
  }
}

export default command;