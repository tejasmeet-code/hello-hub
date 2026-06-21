import type { SlashCommand } from "../types";
import { buildPrankCommandData, runPrankSubcommand } from "../utils/prankFlow";

interface Item {
  id: string;
  originalName: string;
  newName: string;
}

const command: SlashCommand = {
  data: buildPrankCommandData(
    "scramble-roles",
    "Shuffle all role names with each other. Solve to put them back.",
  ),

  async execute(interaction) {
    await runPrankSubcommand<{ items: Item[] }>(interaction, {
      type: "scramble-roles",
      label: "scramble-roles",
      async prepare(i) {
        const guild = i.guild!;
        await guild.roles.fetch();
        const eligible = [...guild.roles.cache.values()].filter(
          (r) => r.name !== "@everyone" && !r.managed,
        );
        if (eligible.length < 2) {
          throw new Error("Need at least 2 manageable roles to scramble.");
        }
        const names = eligible.map((r) => r.name);
        const shuffled = [...names];
        for (let attempt = 0; attempt < 10; attempt++) {
          for (let k = shuffled.length - 1; k > 0; k--) {
            const j = Math.floor(Math.random() * (k + 1));
            [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
          }
          if (shuffled.some((n, idx) => n !== names[idx])) break;
        }
        return {
          items: eligible.map((r, idx) => ({
            id: r.id,
            originalName: r.name,
            newName: shuffled[idx],
          })),
        };
      },
      async apply(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const role = guild.roles.cache.get(it.id);
          if (role) await role.setName(it.newName).catch(() => {});
        }
      },
      async revert(i, data) {
        const guild = i.guild!;
        for (const it of data.items) {
          const role = guild.roles.cache.get(it.id);
          if (role) await role.setName(it.originalName).catch(() => {});
        }
      },
    });
  },
};

export default command;
