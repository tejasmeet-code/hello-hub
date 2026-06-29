import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type User,
  type Role,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";
import { ensureWhitelisted } from "../utils/gate";
import { PERM_WHITELIST } from "../storage/whitelist";
import {
  DM_INTERVAL_MS,
  MAX_RECIPIENTS_HARD_CAP,
  estimateDmSeconds,
  resolveDmRecipients,
  sendDmsToUsers,
  type DmTarget,
} from "../utils/dmCore";
import { EMOJI_INFO } from "../utils/emojis";

function isRole(x: unknown): x is Role {
  return !!x && typeof x === "object" && "hexColor" in x;
}
function isGuildMember(x: unknown): x is GuildMember {
  return !!x && typeof x === "object" && "displayName" in x && "guild" in x;
}
function isUser(x: unknown): x is User {
  return !!x && typeof x === "object" && "username" in x && !("guild" in x) && !("hexColor" in x);
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("dm")
    .setDescription("DM a user, every member with a role, or @everyone.")
    .addMentionableOption((option) =>
      option
        .setName("target")
        .setDescription("A user or role to DM")
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("everyone")
        .setDescription("DM every non-bot member of the server")
        .setRequired(false),
    )
    .setDMPermission(false),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await ensureWhitelisted(interaction, "dm"))) return;
    if (!interaction.guild || !interaction.guildId) return;

    const target = interaction.options.getMentionable("target");
    const everyoneFlag = interaction.options.getBoolean("everyone") ?? false;

    if (!target && !everyoneFlag) {
      await interaction.reply({
        content:
          "Pick a target — either a user/role with `target`, or set `everyone:true`.",
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    const wantsEveryone =
      everyoneFlag ||
      (target && typeof target === "object" && "id" in target &&
        (target as { id: string }).id === guild.id);
    const wantsRole = !wantsEveryone && target && isRole(target);
    const DM_MASS_ONLY_USER_ID = "1181221352393420856";
    const canMassDm = interaction.user.id === DM_MASS_ONLY_USER_ID;

    if ((wantsEveryone || wantsRole) && !canMassDm) {
      await interaction.reply({
        content:
          "Mass DMs (to `@everyone` or to a role) are restricted to a designated user. You can only DM one person at a time.",
        ephemeral: true,
      });
      return;
    }

    let targetDescriptor: string;
    if (wantsEveryone) {
      targetDescriptor = "everyone";
    } else if (target && isRole(target)) {
      targetDescriptor = `role:${target.id}`;
    } else if (target && isGuildMember(target)) {
      targetDescriptor = `member:${target.id}`;
    } else if (target && isUser(target)) {
      targetDescriptor = `user:${target.id}`;
    } else {
      await interaction.reply({
        content: "Unable to resolve the selected target. Please try again.",
        ephemeral: true,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`dm-message|${targetDescriptor}`)
      .setTitle("DM Message");

    const messageInput = new TextInputBuilder()
      .setCustomId("dm_message")
      .setLabel("Message to send")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Write the DM content here...")
      .setRequired(true)
      .setMaxLength(1800);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().setComponents(messageInput),
    );

    await interaction.showModal(modal);
  },
};

export async function handleDmModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({
      content: "This modal can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  const [prefix, descriptor] = interaction.customId.split("|");
  if (prefix !== "dm-message" || !descriptor) {
    return;
  }

  const message = interaction.fields.getTextInputValue("dm_message");
  await interaction.deferReply();

  const guild = interaction.guild;
  const dmTarget: DmTarget = {};
  let label = "";

  if (descriptor === "everyone") {
    dmTarget.everyone = true;
    label = "@everyone";
  } else {
    const [type, id] = descriptor.split(":");
    if (type === "role") {
      const role = await guild.roles.fetch(id).catch(() => null);
      if (!role) {
        await interaction.editReply("Could not find the selected role.");
        return;
      }
      dmTarget.role = role;
      label = `@role ${role.name}`;
    } else if (type === "member") {
      const member = await guild.members.fetch(id).catch(() => null);
      if (!member) {
        await interaction.editReply("Could not find the selected member.");
        return;
      }
      dmTarget.member = member;
      label = `${member.user.tag}`;
    } else if (type === "user") {
      const member = await guild.members.fetch(id).catch(() => null);
      if (!member) {
        await interaction.editReply("Could not find the selected user.");
        return;
      }
      dmTarget.member = member;
      label = `${member.user.tag}`;
    } else {
      await interaction.editReply("Invalid DM target.");
      return;
    }
  }

  let recipients: { users: Map<string, User>; label: string };
  try {
    recipients = await resolveDmRecipients(guild, dmTarget);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply(msg);
    return;
  }

  if (recipients.users.size === 0) {
    await interaction.editReply(
      `No human recipients matched **${recipients.label}**.`,
    );
    return;
  }

  if (recipients.users.size > MAX_RECIPIENTS_HARD_CAP) {
    await interaction.editReply(
      `This would DM **${recipients.users.size}** members, which is over the safety cap of ${MAX_RECIPIENTS_HARD_CAP}. Narrow the target.`,
    );
    return;
  }

  const total = recipients.users.size;
  const seconds = estimateDmSeconds(total, DM_INTERVAL_MS);
  if (total > 1) {
    await interaction.editReply(
      `${EMOJI_INFO} Sending to **${total}** member${total === 1 ? "" : "s"} (${recipients.label}). Estimated time: ~${formatSeconds(seconds)}. I'll edit this with the result when I'm done.`,
    );
  }

  const { sent, failed } = await sendDmsToUsers(
    recipients.users,
    message,
    DM_INTERVAL_MS,
  );
  const failNote =
    failed > 0 ? ` Failed for **${failed}** (DMs closed or blocked).` : "";
  await interaction.editReply(
    `${CE.dm_sent.str} Sent to **${sent}** member${sent === 1 ? "" : "s"} (${recipients.label}).${failNote}`,
  );
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

export default command;
