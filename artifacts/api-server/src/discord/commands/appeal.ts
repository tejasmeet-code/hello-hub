import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("appeal")
    .setDescription("Appeal a punishment — usable in DMs with the bot after a ban.")
    .addStringOption((o) =>
      o
        .setName("guild_id")
        .setDescription("The server ID you were punished in (right-click server icon → Copy Server ID)")
        .setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("case_number")
        .setDescription("Your case number (shown in your punishment DM)")
        .setRequired(true)
        .setMinValue(1),
    )
    .setDMPermission(true),

  globalOnly: true,

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.options.getString("guild_id", true).trim();
    const caseNumber = interaction.options.getInteger("case_number", true);

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`appeal:submit:${guildId}:${caseNumber}`)
        .setTitle("Submit an Appeal")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("punishment_type")
              .setLabel("What punishment are you appealing?")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(50),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("why_happened")
              .setLabel("Why did this punishment happen?")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(500),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("defense")
              .setLabel("Why should this be overturned?")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(500),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("proof")
              .setLabel("Proof / evidence links (optional)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(200),
          ),
        ),
    );
  },
};

export default command;