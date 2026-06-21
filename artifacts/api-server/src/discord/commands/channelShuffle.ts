import { ChannelType, type NonThreadGuildBasedChannel } from "discord.js";
import type { SlashCommand } from "../types";
import { buildPrankCommandData, runPrankSubcommand } from "../utils/prankFlow";

interface Item {
  id: string;
  originalPosition: number;
  newPosition: number;
}

const command: SlashCommand = {
  data: buildPrankCommandData(
    "channel-shuffle",
    "Randomize channel sidebar positions. Solve to restore order.",
  ),

  async execute(interaction) {
    await runPrankSubcommand<{ items: Item[] }>(interaction, {
      type: "channel-shuffle",
      label: "channel-shuffle",
      async prepare(i) {
        const guild = i.guild!;
        await guild.channels.fetch();
        const eligible = [...guild.channels.cache.values()].filter(
          (c): c is NonThreadGuildBasedChannel =>
            !!c && !c.isThread() && c.type !== ChannelType.GuildCategory,
        );
        if (eligible.length < 2) {
          throw new Error("Need at least 2 channels to shuffle.");
        }
        const positions = eligible.map((c) => c.position);
        const shuffled = [...positions];
        for (let attempt = 0; attempt < 10; attempt++) {
          for (let k = shuffled.length - 1; k > 0; k--) {
            const j = Math.floor(Math.random() * (k + 1));
            [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
          }
          if (shuffled.some((p, idx) => p !== positions[idx])) break;
        }
        return {
          items: eligible.map((c, idx) => ({
            id: c.id,
            originalPosition: c.position,
            newPosition: shuffled[idx],
          })),
        };
      },
      async apply(i, data) {
        const guild = i.guild!;
        await guild.channels
          .setPositions(
            data.items.map((it) => ({
              channel: it.id,
              position: it.newPosition,
            })),
          )
          .catch(() => {});
      },
      async revert(i, data) {
        const guild = i.guild!;
        await guild.channels
          .setPositions(
            data.items.map((it) => ({
              channel: it.id,
              position: it.originalPosition,
            })),
          )
          .catch(() => {});
      },
    });
  },
};

export default command;
