import type { Guild, Role } from "discord.js";
import { logger } from "../../lib/logger";

/**
 * Try to push a role to the highest position the bot is allowed to set
 * (Discord won't let any bot put a role above its own current highest role).
 */
export async function pushRoleToTop(guild: Guild, role: Role): Promise<void> {
  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) return;

  // Walk down from the very top until Discord stops complaining.
  const max = guild.roles.highest.position;
  for (let target = max; target >= 1; target--) {
    try {
      await role.setPosition(target);
      return;
    } catch (err) {
      logger.debug({ err, target }, "pushRoleToTop: position rejected, trying lower");
      continue;
    }
  }
}

/**
 * Add a role to the exempt list of every AutoMod rule in the guild so that
 * holders of the role bypass all current AutoMod blocks.
 */
export async function exemptRoleFromAutoMod(
  guild: Guild,
  roleId: string,
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;
  try {
    const rules = await guild.autoModerationRules.fetch();
    for (const rule of rules.values()) {
      const exempt = new Set<string>(rule.exemptRoles.map((r) => r.id));
      if (exempt.has(roleId)) continue;
      exempt.add(roleId);
      try {
        await rule.edit({ exemptRoles: [...exempt] });
        updated++;
      } catch (err) {
        failed++;
        logger.warn({ err, ruleId: rule.id }, "Failed to exempt role from AutoMod rule");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to fetch AutoMod rules");
  }
  return { updated, failed };
}
