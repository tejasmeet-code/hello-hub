/** XP needed to advance from level `n` to `n+1` (MEE6-style formula) */
export function xpToNextLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Total cumulative XP required to reach a given level from level 0 */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpToNextLevel(i);
  return total;
}

/** Derive current level from total cumulative XP */
export function levelFromTotalXp(totalXp: number): number {
  let level = 0;
  while (totalXp >= totalXpForLevel(level + 1)) level++;
  return level;
}

/** XP earned within the current level (progress toward the next) */
export function xpInCurrentLevel(totalXp: number): number {
  const level = levelFromTotalXp(totalXp);
  return totalXp - totalXpForLevel(level);
}

/** Build a unicode text progress bar — e.g. `██████░░░░ 340/500 XP` */
export function progressBar(current: number, total: number, length = 12): string {
  const pct = total === 0 ? 0 : Math.min(1, current / total);
  const filled = Math.round(pct * length);
  const bar = "█".repeat(filled) + "░".repeat(length - filled);
  return `\`${bar}\` ${current}/${total} XP`;
}
