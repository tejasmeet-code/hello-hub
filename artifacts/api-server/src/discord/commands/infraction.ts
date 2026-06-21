import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import infractions from "./infractions";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("infraction")
    .setDescription("Manage infractions on a staff profile.")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("View a staff member's infractions.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Staff member").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add an infraction to a staff profile.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Staff member").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Infraction type")
            .setRequired(true)
            .addChoices(
              { name: "Warning", value: "warning" },
              { name: "Strike (expires in 14 days)", value: "strike" },
              { name: "Demotion (manual log)", value: "demotion" },
              { name: "Termination (manual log)", value: "termination" },
            ),
        )
        .addStringOption((o) =>
          o.setName("reason").setDescription("Reason").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove an infraction by id.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Staff member").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("infraction-id")
            .setDescription("Infraction id (from /infractions view)")
            .setRequired(true),
        ),
    ),

  execute(interaction: ChatInputCommandInteraction) {
    return infractions.execute(interaction);
  },
};

export default command;