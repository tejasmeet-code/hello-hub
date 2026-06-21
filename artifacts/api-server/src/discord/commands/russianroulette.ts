import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

interface Chamber {
  bullet: number;
  pulled: number;
}

const chambers = new Map<string, Chamber>();

function freshChamber(): Chamber {
  return { bullet: Math.floor(Math.random() * 6), pulled: 0 };
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("russianroulette")
    .setDescription(
      "Pull the trigger. 1-in-6 chance per pull. Chamber resets per channel.",
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const k = interaction.channelId ?? `dm:${interaction.user.id}`;
    let c = chambers.get(k);
    if (!c) {
      c = freshChamber();
      chambers.set(k, c);
    }

    const isBang = c.pulled === c.bullet;
    c.pulled += 1;
    const remaining = 6 - c.pulled;

    if (isBang) {
      chambers.set(k, freshChamber());
      await interaction.reply(
        `${CE.roulette.str} **BANG!** <@${interaction.user.id}> took the bullet. Reloading…`,
      );
      return;
    }

    if (remaining === 0) {
      chambers.set(k, freshChamber());
      await interaction.reply(
        `${CE.roulette.str} *click* — somehow you survived all 6 pulls. Reloading…`,
      );
      return;
    }

    await interaction.reply(
      `${CE.roulette.str} *click* — <@${interaction.user.id}> survives. ${remaining} pull${remaining === 1 ? "" : "s"} left in this chamber.`,
    );
  },
};

export default command;
