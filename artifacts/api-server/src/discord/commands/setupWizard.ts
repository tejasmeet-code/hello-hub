import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type RoleSelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getGuildConfig, updateGuildConfig } from "../storage/config";
import { CE } from "../utils/embedStyle";

// In-memory state tracking for active setup wizards per guild/user
interface WizardState {
  step: number;
  mainRoleId?: string;
  staffCommonRoleId?: string;
  staffRoleHierarchy?: string[];
}

const activeWizards = new Map<string, WizardState>();

export const setupWizardCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Run the interactive onboarding setup wizard to configure key roles and unlock commands.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
      return;
    }

    const state: WizardState = { step: 1 };
    activeWizards.set(`${interaction.guildId}:${interaction.user.id}`, state);

    const embed = new EmbedBuilder()
      .setTitle(`${CE.settings.str} Server Setup Wizard — Step 1/3: Main Role`)
      .setDescription(
        "Select the **Main Role ID** that is automatically assigned to every general member.\n\nUse the role selector below or click **Skip Step 1** to bypass.",
      )
      .setColor(0x2b2d31);

    const selectRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("wiz:step1:select")
        .setPlaceholder("Select Main Role (Default Member Role)...")
        .setMinValues(1)
        .setMaxValues(1),
    );

    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("wiz:step1:skip")
        .setLabel("Skip Step 1")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({ embeds: [embed], components: [selectRow, btnRow] });
  },
};

export async function handleWizardSelect(interaction: RoleSelectMenuInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;
  const key = `${guildId}:${interaction.user.id}`;
  const state = activeWizards.get(key) ?? { step: 1 };

  if (interaction.customId === "wiz:step1:select") {
    state.mainRoleId = interaction.values[0];
    state.step = 2;
    activeWizards.set(key, state);
    await showStep2(interaction);
  } else if (interaction.customId === "wiz:step2:select") {
    state.staffCommonRoleId = interaction.values[0];
    state.step = 3;
    activeWizards.set(key, state);
    await showStep3(interaction);
  }
}

export async function handleWizardButton(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;
  const key = `${guildId}:${interaction.user.id}`;
  const state = activeWizards.get(key) ?? { step: 1 };

  if (interaction.customId === "wiz:step1:skip") {
    state.mainRoleId = undefined;
    state.step = 2;
    activeWizards.set(key, state);
    await showStep2(interaction);
  } else if (interaction.customId === "wiz:step2:skip") {
    state.staffCommonRoleId = undefined;
    state.step = 3;
    activeWizards.set(key, state);
    await showStep3(interaction);
  } else if (interaction.customId === "wiz:step3:enter") {
    const modal = new ModalBuilder()
      .setCustomId("wiz:step3:modal")
      .setTitle("Staff Role Hierarchy")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("hierarchy")
            .setLabel("Role IDs (Highest Authority -> Lowest)")
            .setPlaceholder("Enter role IDs separated by commas (e.g. 111111,222222,333333)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false),
        ),
      );
    await interaction.showModal(modal);
  } else if (interaction.customId === "wiz:step3:skip") {
    state.staffRoleHierarchy = [];
    await finishWizard(interaction, state);
  }
}

export async function handleWizardModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId !== "wiz:step3:modal") return;
  const guildId = interaction.guildId;
  if (!guildId) return;
  const key = `${guildId}:${interaction.user.id}`;
  const state = activeWizards.get(key) ?? { step: 3 };

  const raw = interaction.fields.getTextInputValue("hierarchy").trim();
  const hierarchy: string[] = [];
  if (raw) {
    for (const item of raw.split(",")) {
      const id = item.trim();
      if (/^\d+$/.test(id)) hierarchy.push(id);
    }
  }
  state.staffRoleHierarchy = hierarchy;
  await finishWizard(interaction, state);
}

async function showStep2(interaction: RoleSelectMenuInteraction | ButtonInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle(`${CE.settings.str} Server Setup Wizard — Step 2/3: Staff Common Role`)
    .setDescription(
      "Select the **Staff Common Role ID** shared by all moderators and administrators.\n\nUse the role selector below or click **Skip Step 2** to bypass.",
    )
    .setColor(0x2b2d31);

  const selectRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("wiz:step2:select")
      .setPlaceholder("Select Staff Common Role...")
      .setMinValues(1)
      .setMaxValues(1),
  );

  const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("wiz:step2:skip")
      .setLabel("Skip Step 2")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [selectRow, btnRow] });
}

async function showStep3(interaction: RoleSelectMenuInteraction | ButtonInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle(`${CE.settings.str} Server Setup Wizard — Step 3/3: Staff Role Hierarchy`)
    .setDescription(
      "Configure the **Staff Role Hierarchy** (ranked ordered list from **Highest Authority to Lowest Authority**).\n\nClick the button below to enter comma-separated Role IDs, or click **Skip Step 3 & Finish**.",
    )
    .setColor(0x2b2d31);

  const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("wiz:step3:enter")
      .setLabel("Enter Staff Role Hierarchy")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(CE.settings.str),
    new ButtonBuilder()
      .setCustomId("wiz:step3:skip")
      .setLabel("Skip Step 3 & Finish")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [btnRow] });
}

async function finishWizard(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  state: WizardState,
): Promise<void> {
  const guildId = interaction.guildId!;
  await updateGuildConfig(guildId, (cfg) => ({
    ...cfg,
    setupWizardCompleted: true,
    setupConfig: {
      mainRoleId: state.mainRoleId,
      staffCommonRoleId: state.staffCommonRoleId,
      staffRoleHierarchy: state.staffRoleHierarchy ?? [],
    },
  }));

  const mainRoleText = state.mainRoleId ? `<@&${state.mainRoleId}>` : "Not set (Skipped)";
  const staffRoleText = state.staffCommonRoleId ? `<@&${state.staffCommonRoleId}>` : "Not set (Skipped)";
  const hierarchyText =
    state.staffRoleHierarchy && state.staffRoleHierarchy.length > 0
      ? state.staffRoleHierarchy.map((r) => `<@&${r}>`).join(" -> ")
      : "Not set (Skipped)";

  const embed = new EmbedBuilder()
    .setTitle(`${CE.success.str} Server Setup Complete!`)
    .setDescription("The server onboarding wizard has captured your configurations and unlocked normal command usage.")
    .setColor(0x57f287)
    .addFields(
      { name: "1️⃣ Main Role ID", value: mainRoleText, inline: false },
      { name: "2️⃣ Staff Common Role ID", value: staffRoleText, inline: false },
      { name: "3️⃣ Staff Role Hierarchy (Highest -> Lowest)", value: hierarchyText, inline: false },
    )
    .setFooter({ text: "Normal command restrictions are now lifted for this server." });

  if (interaction.isButton()) {
    await interaction.update({ embeds: [embed], components: [] });
  } else {
    await interaction.reply({ embeds: [embed], components: [] });
  }
}

export default setupWizardCommand;
