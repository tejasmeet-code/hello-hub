import { ChannelType, type GuildChannel } from "discord.js";
import type { SlashCommand } from "../types";
import { buildPrankCommandData, runPrankSubcommand } from "../utils/prankFlow";

const EMOJI_POOL = [
  "👻", "🎃", "💀", "🦇", "🌙", "⚡", "🔥", "✨", "🌈",
  "🍕", "🦄", "🐸", "🦊", "🐙", "🪐", "🍩", "🎲", "🎈",
];

interface Item {
  id: string;
  originalName: string;
  newName: string;
}

function makeEmojiName(): string {
  const length = 4 + Math.floor(Math.random() * 3);
  return Array.from({ length }, () =>
    EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)],
  ).join("");
}

const command: SlashCommand = {
  data: buildPrankCommandData(
    "emoji-channels",
    "Replace every channel name with random emojis. Solve to restore.",
  ),

  async execute(interaction) {
    await runPrankSubcommand<{ items: Item[] }>(interaction, {
      type: "emoji-channels",
      label: "emoji-channels",
      async prepare(i) {
        const guild = i.guild!;
        await guild.channels.fetch();
        const items: Item[] = [];
        const used = new Set<string>();
        for (const ch of guild.channels.cache.values()) {
          if (!ch || ch.isThread()) continue;
          if (ch.type === ChannelType.GuildCategory) continue;
          let candidate = makeEmojiName();
          for (let tries = 0; tries < 10 && used.has(candidate); tries++) {
            candidate = makeEmojiName();
          }
          used.add(candidate);
          items.push({ id: ch.id, originalName: ch.name, newName: candidate });
        }
        if (items.length === 0) throw new Error("No channels to rename.");
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
