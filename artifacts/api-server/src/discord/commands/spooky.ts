import { ChannelType, type GuildChannel } from "discord.js";
import type { SlashCommand } from "../types";
import { buildPrankCommandData, runPrankSubcommand } from "../utils/prankFlow";

interface Data {
  prefix: string;
  channels: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}

const command: SlashCommand = {
  data: buildPrankCommandData(
    "spooky",
    "Prefix every channel and role with a theme word. Solve to revert.",
    (s) =>
      s.addStringOption((o) =>
        o
          .setName("theme")
          .setDescription("Prefix word (default: spooky)")
          .setRequired(false)
          .setMaxLength(20),
      ),
  ),

  async execute(interaction) {
    await runPrankSubcommand<Data>(interaction, {
      type: "spooky",
      label: "spooky",
      async prepare(i) {
        const theme = (i.options.getString("theme") ?? "spooky").trim();
        const prefix = `${theme}-`;
        const guild = i.guild!;
        await guild.channels.fetch();
        await guild.roles.fetch();
        const channels: Data["channels"] = [];
        const roles: Data["roles"] = [];
        for (const ch of guild.channels.cache.values()) {
          if (!ch || ch.isThread()) continue;
          if (ch.type === ChannelType.GuildCategory) continue;
          if (ch.name.startsWith(prefix)) continue;
          channels.push({ id: ch.id, name: ch.name });
        }
        for (const role of guild.roles.cache.values()) {
          if (role.name === "@everyone" || role.managed) continue;
          if (role.name.startsWith(prefix)) continue;
          roles.push({ id: role.id, name: role.name });
        }
        return { prefix, channels, roles };
      },
      async apply(i, data) {
        const guild = i.guild!;
        for (const c of data.channels) {
          const ch = guild.channels.cache.get(c.id) as GuildChannel | undefined;
          if (!ch) continue;
          await ch.setName(`${data.prefix}${c.name}`.slice(0, 100)).catch(() => {});
        }
        for (const r of data.roles) {
          const role = guild.roles.cache.get(r.id);
          if (!role) continue;
          await role.setName(`${data.prefix}${r.name}`.slice(0, 100)).catch(() => {});
        }
      },
      async revert(i, data) {
        const guild = i.guild!;
        for (const c of data.channels) {
          const ch = guild.channels.cache.get(c.id) as GuildChannel | undefined;
          if (ch) await ch.setName(c.name).catch(() => {});
        }
        for (const r of data.roles) {
          const role = guild.roles.cache.get(r.id);
          if (role) await role.setName(r.name).catch(() => {});
        }
      },
    });
  },
};

export default command;
