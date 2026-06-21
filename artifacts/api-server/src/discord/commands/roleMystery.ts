import type { SlashCommand } from "../types";
import { buildPrankCommandData, runPrankSubcommand } from "../utils/prankFlow";

interface Item {
  id: string;
  originalName: string;
  newName: string;
}

const command: SlashCommand = {
  data: buildPrankCommandData(
    "role-mystery",
    "Hide every role behind '???-N'. Solve to restore.",
  ),

  async execute(interaction) {
    await runPrankSubcommand<{ items: Item[] }>(interaction, {
      type: "role-mystery",
      label: "role-mystery",
      async prepare(i) {
        const guild = i.guild!;
        await guild.roles.fetch();
        const eligible = [...guild.roles.cache.values()]
          .filter((r) => r.name !== "@everyone" && !r.managed)
          .sort((a, b) => b.position - a.position);
        if (eligible.length === 0) {
          throw new Error("No manageable roles found.");
        }
        return {
          items: eligible.map((r, idx) => ({
            id: r.id,
            originalName: r.name,
            newName: `???-${idx + 1}`,
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
