import { ChannelType, type GuildChannel } from "discord.js";
import type { SlashCommand } from "../types";
import { buildPrankCommandData, runPrankSubcommand } from "../utils/prankFlow";

interface Item {
  id: string;
  originalName: string;
  newName: string;
}

const command: SlashCommand = {
  data: buildPrankCommandData(
    "upside-down",
    "Reverse every channel name. Solve to flip them back.",
  ),

  async execute(interaction) {
    await runPrankSubcommand<{ items: Item[] }>(interaction, {
      type: "upside-down",
      label: "upside-down",
      async prepare(i) {
        const guild = i.guild!;
        await guild.channels.fetch();
        const items: Item[] = [];
        for (const ch of guild.channels.cache.values()) {
          if (!ch || ch.isThread()) continue;
          if (ch.type === ChannelType.GuildCategory) continue;
          const reversed = [...ch.name].reverse().join("");
          if (reversed === ch.name) continue;
          items.push({ id: ch.id, originalName: ch.name, newName: reversed });
        }
        if (items.length === 0) {
          throw new Error("No channels eligible.");
        }
        return { items };
      },
      async apply(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const ch = guild.channels.cache.get(it.id) as GuildChannel | undefined;
          if (ch) await ch.setName(it.newName).catch(() => {});
        }
      },
      async revert(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const ch = guild.channels.cache.get(it.id) as GuildChannel | undefined;
          if (ch) await ch.setName(it.originalName).catch(() => {});
        }
      },
    });
  },
};

export default command;
