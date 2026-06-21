import { ChannelType, type NonThreadGuildBasedChannel } from "discord.js";
import type { SlashCommand } from "../types";
import { buildPrankCommandData, runPrankSubcommand } from "../utils/prankFlow";

interface Item {
  id: string;
  originalName: string;
  newName: string;
}

const command: SlashCommand = {
  data: buildPrankCommandData(
    "scramble-channels",
    "Shuffle all channel names with each other. Solve to put them back.",
  ),

  async execute(interaction) {
    await runPrankSubcommand<{ items: Item[] }>(interaction, {
      type: "scramble-channels",
      label: "scramble-channels",
      async prepare(i) {
        const guild = i.guild!;
        await guild.channels.fetch();
        const eligible = [...guild.channels.cache.values()].filter(
          (c): c is NonThreadGuildBasedChannel =>
            !!c && !c.isThread() && c.type !== ChannelType.GuildCategory,
        );
        if (eligible.length < 2) {
          throw new Error("Need at least 2 channels to scramble.");
        }
        const names = eligible.map((c) => c.name);
        const shuffled = [...names];
        for (let attempt = 0; attempt < 10; attempt++) {
          for (let k = shuffled.length - 1; k > 0; k--) {
            const j = Math.floor(Math.random() * (k + 1));
            [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
          }
          if (shuffled.some((n, idx) => n !== names[idx])) break;
        }
        return {
          items: eligible.map((c, idx) => ({
            id: c.id,
            originalName: c.name,
            newName: shuffled[idx],
          })),
        };
      },
      async apply(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const ch = guild.channels.cache.get(it.id) as NonThreadGuildBasedChannel | undefined;
          if (ch) await ch.setName(it.newName).catch(() => {});
        }
      },
      async revert(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const ch = guild.channels.cache.get(it.id) as NonThreadGuildBasedChannel | undefined;
          if (ch) await ch.setName(it.originalName).catch(() => {});
        }
      },
    });
  },
};

export default command;
