import type { Client } from "discord.js";
import { logger } from "../../lib/logger";
import {
  getAllGuildIds,
  listAllProfiles,
  markInfractionExpiryDmSent,
} from "../storage/staff";
import { getGuildConfig, getInfractionsConfig } from "../storage/config";
import { prettyEmbed, buildBullets, COLORS, CE } from "./embedStyle";

const TICK_MS = 60 * 60 * 1000;

export function startInfractionExpiryScheduler(client: Client): void {
  setInterval(() => void tick(client), TICK_MS);
  logger.info("Infraction expiry scheduler started (1h tick)");
}

async function tick(client: Client): Promise<void> {
  const guildIds = await getAllGuildIds();
  const now = Date.now();

  for (const guildId of guildIds) {
    try {
      const cfg = await getGuildConfig(guildId);
      const { dmOnInfraction } = getInfractionsConfig(cfg);
      if (!dmOnInfraction) continue;

      const profiles = await listAllProfiles(guildId);
      const guildName = client.guilds.cache.get(guildId)?.name ?? guildId;

      for (const profile of profiles) {
        for (const inf of profile.infractions) {
          if (!inf.expiresAt) continue;
          if (inf.expiresAt > now) continue;
          if (inf.expiryDmSent) continue;

          await markInfractionExpiryDmSent(guildId, profile.userId, inf.id);

          const typeLabel = inf.type.charAt(0).toUpperCase() + inf.type.slice(1);

          client.users.fetch(profile.userId).then((user) =>
            user.send({
              embeds: [prettyEmbed({
                title: `${typeLabel} Expired`,
                description: `${CE.success.str}\n\n${buildBullets([
                  { label: "Server", value: guildName },
                  { label: "Type", value: typeLabel },
                  { label: "Reason", value: inf.reason },
                  { label: "Issued", value: `<t:${Math.floor(inf.at / 1000)}:D>` },
                  { label: "Expired", value: `<t:${Math.floor(inf.expiresAt! / 1000)}:D>` },
                ])}\n\nThis infraction no longer counts against your record.`,
                color: COLORS.success,
                footer: "Relosta Bot",
              })],
            }),
          ).catch(() => {});

          logger.info({ guildId, userId: profile.userId, infractionId: inf.id, type: inf.type }, "Infraction expiry DM sent");
        }
      }
    } catch (err) {
      logger.error({ err, guildId }, "Infraction expiry scheduler tick error");
    }
  }
}