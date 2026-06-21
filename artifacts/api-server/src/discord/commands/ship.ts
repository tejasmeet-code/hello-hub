import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createHash } from "node:crypto";
import type { SlashCommand } from "../types";
import { CE } from "../utils/embedStyle";

function compatibility(a: string, b: string): number {
  const [x, y] = [a, b].sort();
  const hash = createHash("sha256").update(`${x}:${y}`).digest();
  return hash.readUInt32BE(0) % 101;
}

function bar(pct: number): string {
  const filled = Math.round(pct / 10);
  return CE.ship_filled.str.repeat(filled) + CE.ship_empty.str.repeat(10 - filled);
}

function verdict(pct: number): string {
  if (pct >= 90) return `Soulmates. Ring it up. ${CE.soulmates_ring.str}`;
  if (pct >= 75) return `Real chemistry here. ${CE.big_win.str}`;
  if (pct >= 50) return `Could work with effort. ${CE.small_win.str}`;
  if (pct >= 25) return `Stay friends, please. ${CE.no_luck_face.str}`;
  return `Disaster waiting to happen. ${CE.dead.str}`;
}

function shipName(a: string, b: string): string {
  const half1 = a.slice(0, Math.ceil(a.length / 2));
  const half2 = b.slice(Math.floor(b.length / 2));
  return half1 + half2;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ship")
    .setDescription("Calculate the compatibility between two users.")
    .addUserOption((o) =>
      o.setName("user1").setDescription("First user").setRequired(true),
    )
    .addUserOption((o) =>
      o.setName("user2").setDescription("Second user").setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const a = interaction.options.getUser("user1", true);
    const b = interaction.options.getUser("user2", true);
    if (a.id === b.id) {
      await interaction.reply({
        content: "Pick two different people.",
        ephemeral: true,
      });
      return;
    }
    const pct = compatibility(a.id, b.id);
    const ship = shipName(a.username, b.username);
    await interaction.reply(
      `${CE.ship_header.str} **${a.username}** + **${b.username}** = **${ship}**\n` +
      `${bar(pct)} **${pct}%**\n${verdict(pct)}`,
    );
  },
};

export default command;
