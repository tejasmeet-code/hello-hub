import type { SlashCommand } from "../types";
import { buildPrankCommandData, runPrankSubcommand } from "../utils/prankFlow";

interface Item {
  id: string;
  originalColor: number;
  newColor: number;
}

const command: SlashCommand = {
  data: buildPrankCommandData(
    "role-rainbow",
    "Randomize every role color. Solve to restore.",
  ),

  async execute(interaction) {
    await runPrankSubcommand<{ items: Item[] }>(interaction, {
      type: "role-rainbow",
      label: "role-rainbow",
      async prepare(i) {
        const guild = i.guild!;
        await guild.roles.fetch();
        const items: Item[] = [];
        for (const role of guild.roles.cache.values()) {
          if (role.name === "@everyone" || role.managed) continue;
          items.push({
            id: role.id,
            originalColor: role.color,
            newColor: Math.floor(Math.random() * 0xffffff) + 1,
          });
        }
        if (items.length === 0) {
          throw new Error("No manageable roles to color.");
        }
        return { items };
      },
      async apply(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const role = guild.roles.cache.get(it.id);
          if (role) await role.setColor(it.newColor).catch(() => {});
        }
      },
      async revert(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const role = guild.roles.cache.get(it.id);
          if (role) await role.setColor(it.originalColor).catch(() => {});
        }
      },
    });
  },
};

export default command;
