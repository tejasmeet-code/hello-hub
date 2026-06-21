import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  savePrank,
  getPrank,
  removePrank,
  checkPrankCode,
  type PrankType,
} from "../storage/pranks";
import { EMOJI_ERROR, EMOJI_INFO, EMOJI_SUCCESS } from "./emojis";

export interface PrankHandlers<T> {
  type: PrankType;
  label: string;
  prepare: (interaction: ChatInputCommandInteraction) => Promise<T>;
  apply: (interaction: ChatInputCommandInteraction, data: T) => Promise<void>;
  revert: (interaction: ChatInputCommandInteraction, data: T) => Promise<void>;
}

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
    false
  );
}

export function buildPrankCommandData(
  name: string,
  description: string,
  startExtras?: (
    sub: SlashCommandSubcommandBuilder,
  ) => SlashCommandSubcommandBuilder,
): SlashCommandSubcommandsOnlyBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDMPermission(false)
    .addSubcommand((s) => {
      s.setName("start")
        .setDescription("Admin: apply the prank.")
        .addStringOption((o) =>
          o
            .setName("code")
            .setDescription("Code players must guess to revert")
            .setRequired(true)
            .setMaxLength(64),
        )
        .addStringOption((o) =>
          o
            .setName("hint")
            .setDescription("Optional hint shown on wrong guess")
            .setRequired(false)
            .setMaxLength(200),
        );
      return startExtras ? startExtras(s) : s;
    })
    .addSubcommand((s) =>
      s
        .setName("solve")
        .setDescription("Guess the code to restore the server.")
        .addStringOption((o) =>
          o
            .setName("code")
            .setDescription("Your guess")
            .setRequired(true)
            .setMaxLength(64),
        ),
    )
    .addSubcommand((s) =>
      s.setName("end").setDescription("Admin: force-end without the code."),
    );
}

export async function runPrankSubcommand<T>(
  interaction: ChatInputCommandInteraction,
  handlers: PrankHandlers<T>,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }
  const sub = interaction.options.getSubcommand(true);

  if (sub === "start") {
    if (!isAdmin(interaction)) {
      await interaction.reply({ content: "Admin only.", ephemeral: true });
      return;
    }
    const existing = await getPrank<T>(handlers.type, interaction.guildId);
    if (existing) {
      await interaction.reply({
        content: `\`${handlers.label}\` is already running. Use \`solve\` or \`end\` first.`,
        ephemeral: true,
      });
      return;
    }
    const code = interaction.options.getString("code", true);
    const hint = interaction.options.getString("hint") ?? undefined;
    await interaction.deferReply({ ephemeral: true });
    try {
      const data = await handlers.prepare(interaction);
      await savePrank(
        handlers.type,
        interaction.guildId,
        code,
        data,
        interaction.user.id,
        hint,
      );
      await handlers.apply(interaction, data);
      await interaction.editReply(
        `${EMOJI_SUCCESS} \`${handlers.label}\` is now active. Members can revert with \`/${handlers.label} solve code:<guess>\`.` +
          (hint ? `\n*Wrong-guess hint:* ${hint}` : ""),
      );
    } catch (err) {
      await interaction.editReply(
        `Couldn't apply \`${handlers.label}\`: ${(err as Error).message ?? "unknown error"}.`,
      );
    }
    return;
  }

  if (sub === "solve") {
    const record = await getPrank<T>(handlers.type, interaction.guildId);
    if (!record) {
      await interaction.reply({
        content: `\`${handlers.label}\` isn't active.`,
        ephemeral: true,
      });
      return;
    }
    const code = interaction.options.getString("code", true);
    if (!checkPrankCode(code, record)) {
      await interaction.reply({
        content: `${EMOJI_ERROR} Wrong code.${record.hint ? `\n${EMOJI_INFO} Hint: *${record.hint}*` : ""}`,
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply();
    try {
      await handlers.revert(interaction, record.data);
      await removePrank(handlers.type, interaction.guildId);
      await interaction.editReply(
        `${EMOJI_SUCCESS} <@${interaction.user.id}> solved \`${handlers.label}\`! Server restored.`,
      );
    } catch (err) {
      await interaction.editReply(
        `Code was correct but revert had issues: ${(err as Error).message ?? "unknown error"}.`,
      );
    }
    return;
  }

  if (sub === "end") {
    if (!isAdmin(interaction)) {
      await interaction.reply({ content: "Admin only.", ephemeral: true });
      return;
    }
    const record = await getPrank<T>(handlers.type, interaction.guildId);
    if (!record) {
      await interaction.reply({
        content: `\`${handlers.label}\` isn't active.`,
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      await handlers.revert(interaction, record.data);
      await removePrank(handlers.type, interaction.guildId);
      await interaction.editReply(`${EMOJI_ERROR} Force-ended \`${handlers.label}\`.`);
    } catch (err) {
      await interaction.editReply(
        `Revert had issues: ${(err as Error).message ?? "unknown error"}.`,
      );
    }
  }
}
