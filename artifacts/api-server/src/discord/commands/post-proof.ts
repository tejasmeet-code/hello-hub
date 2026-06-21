import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { getShopSettings } from "../storage/shop";
import { listStaffRoles } from "../storage/staff";
import { CE, COLORS } from "../utils/embedStyle";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("post-proof")
    .setDescription("Post proof of a completed sale to the configured proof channel.")
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId || !interaction.guild) return;

    const ss = await getShopSettings(interaction.guildId);

    const guildStaffRoles = await listStaffRoles(interaction.guildId);
    const allModRoleIds = [...new Set([...ss.modRoleIds, ...guildStaffRoles.map((r) => r.roleId)])];
    const isAdmin = interaction.guild.ownerId === interaction.user.id
      || (interaction.memberPermissions?.has(8n) ?? false);
    const isStaff = isAdmin
      || allModRoleIds.some((r) => (interaction.member?.roles as any)?.cache?.has(r))
      || ss.adminRoleIds.some((r) => (interaction.member?.roles as any)?.cache?.has(r));

    if (!isStaff) {
      await interaction.reply({ content: `${CE.error.str} Only shop staff can post sale proofs.`, flags: 1 << 6 });
      return;
    }

    if (!ss.proofChannelId) {
      await interaction.reply({
        content: `${CE.error.str} No proof channel has been set. Ask an admin to configure it in \`/config\` → Shop module.`,
        flags: 1 << 6,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId("postproof:modal")
      .setTitle("Post Sale Proof");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("item")
          .setLabel("What was sold?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(200)
          .setPlaceholder("e.g. Discord Nitro 1 Month"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("buyer")
          .setLabel("Buyer (username or @mention)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder("e.g. john_doe or @JohnDoe"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("price")
          .setLabel("Price / Payment")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder("e.g. $10 USD via PayPal"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("proof")
          .setLabel("Proof (image URL or description)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setPlaceholder("Paste an image link or describe the proof"),
      ),
    );

    await interaction.showModal(modal);

    let submit;
    try {
      submit = await interaction.awaitModalSubmit({
        filter: (s) => s.customId === "postproof:modal" && s.user.id === interaction.user.id,
        time: 10 * 60 * 1000,
      });
    } catch {
      return;
    }

    const item  = submit.fields.getTextInputValue("item").trim();
    const buyer = submit.fields.getTextInputValue("buyer").trim();
    const price = submit.fields.getTextInputValue("price").trim();
    const proof = submit.fields.getTextInputValue("proof").trim();

    const proofChannel = interaction.guild.channels.cache.get(ss.proofChannelId!) as any;
    if (!proofChannel?.send) {
      await submit.reply({ content: `${CE.error.str} The configured proof channel could not be found. Please reconfigure it in \`/config\`.`, flags: 1 << 6 });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${CE.cash.str} Sale Proof`)
      .setColor(COLORS.success)
      .addFields(
        { name: "Item Sold", value: item, inline: true },
        { name: "Buyer", value: buyer, inline: true },
        { name: "Price / Payment", value: price, inline: true },
        { name: "Proof", value: proof, inline: false },
      )
      .setFooter({ text: `Submitted by ${interaction.user.tag}` })
      .setTimestamp();

    const isImageUrl = /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(proof);
    if (isImageUrl) embed.setImage(proof);

    try {
      await proofChannel.send({ embeds: [embed] });
    } catch {
      await submit.reply({ content: `${CE.error.str} Failed to send proof to <#${ss.proofChannelId}>. Check my permissions.`, flags: 1 << 6 });
      return;
    }

    await submit.reply({
      content: `${CE.success.str} Proof posted to <#${ss.proofChannelId}>.`,
      flags: 1 << 6,
    });
  },
};

export default command;