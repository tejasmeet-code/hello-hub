import type { SlashCommand } from "../types";
import { buildPrankCommandData, runPrankSubcommand } from "../utils/prankFlow";

const CURSED_NAMES = [
  "Skeleton", "Ghost", "Witch", "Vampire", "Goblin", "Zombie",
  "Ghoul", "Wraith", "Phantom", "Banshee", "Mummy", "Demon",
  "Specter", "Reaper", "Lich", "Imp", "Hag", "Cultist",
];

interface Item {
  id: string;
  originalNick: string | null;
  newNick: string;
}

const MAX_MEMBERS = 100;

const command: SlashCommand = {
  data: buildPrankCommandData(
    "cursed-nicknames",
    "Replace member nicknames with cursed alter-egos. Solve to restore.",
  ),

  async execute(interaction) {
    await runPrankSubcommand<{ items: Item[] }>(interaction, {
      type: "cursed-nicknames",
      label: "cursed-nicknames",
      async prepare(i) {
        const guild = i.guild!;
        const me = guild.members.me;
        if (!me) throw new Error("Bot member not found.");
        const all = await guild.members.fetch();
        const candidates = [...all.values()]
          .filter(
            (m) =>
              !m.user.bot &&
              m.id !== guild.ownerId &&
              m.manageable &&
              me.roles.highest.position > m.roles.highest.position,
          )
          .slice(0, MAX_MEMBERS);
        if (candidates.length === 0) {
          throw new Error("No members the bot can rename.");
        }
        return {
          items: candidates.map((m, idx) => ({
            id: m.id,
            originalNick: m.nickname,
            newNick: `${CURSED_NAMES[idx % CURSED_NAMES.length]} #${idx + 1}`,
          })),
        };
      },
      async apply(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const m = guild.members.cache.get(it.id);
          if (m) await m.setNickname(it.newNick).catch(() => {});
        }
      },
      async revert(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const m = guild.members.cache.get(it.id);
          if (m) await m.setNickname(it.originalNick).catch(() => {});
        }
      },
    });
  },
};

export default command;
