import { EmbedBuilder, type APIEmbedField, type ColorResolvable } from "discord.js";

export const COLORS = {
  primary: 0x2b2d31,
  success: 0x57f287,
  warning: 0xfee75c,
  danger:  0xed4245,
  info:    0x5dade2,
  neutral: 0x99aab5,
  staff:   0x9b59b6,
  premium: 0xffd700,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM EMOJI REGISTRY — All from the Relosta Bot emoji server
// Update IDs here and every command/embed updates automatically.
// Static:   <:name:id>   |   Animated: <a:name:id>
// ─────────────────────────────────────────────────────────────────────────────
export const CE = {
  // ── Status ───────────────────────────────────────────────────────────────
  success:       { str: "<:bluetick:1517479805388591226>",    id: "1517479805388591226", name: "bluetick",     animated: false },
  check:         { str: "<:tick:1517479233784643634>",        id: "1517479233784643634", name: "tick",         animated: false },
  check_yes:     { str: "<:tick:1517479233784643634>",        id: "1517479233784643634", name: "tick",         animated: false },
  check_no:      { str: "<:no:1517468675395817532>",          id: "1517468675395817532", name: "no",           animated: false },
  loading:       { str: "<a:loading:1517480131265040434>",    id: "1517480131265040434", name: "loading",      animated: true  },
  error:         { str: "<:no:1517468675395817532>",          id: "1517468675395817532", name: "no",           animated: false },
  failure:       { str: "<:failure:1517469374594945134>",     id: "1517469374594945134", name: "failure",      animated: false },
  failureorno:   { str: "<:failed:1517478180661891072>",      id: "1517478180661891072", name: "failed",       animated: false },
  warning:       { str: "<:wrning:1517468806186799125>",      id: "1517468806186799125", name: "wrning",       animated: false },
  // ── People ───────────────────────────────────────────────────────────────
  members:       { str: "<:trget:1517468874440970250>",       id: "1517468874440970250", name: "trget",        animated: false },
  staff:         { str: "<a:staff:1517479713466089472>",      id: "1517479713466089472", name: "staff",        animated: true  },
  admin:         { str: "<:admin:1517469748403896423>",       id: "1517469748403896423", name: "admin",        animated: false },
  manager:       { str: "<:manager:1517480449138495549>",     id: "1517480449138495549", name: "manager",      animated: false },
  owner:         { str: "<:owner:1517479528098959440>",       id: "1517479528098959440", name: "owner",        animated: false },
  // ── Moderation ───────────────────────────────────────────────────────────
  moderation:    { str: "<:moderator:1517480212189810728>",   id: "1517480212189810728", name: "moderator",    animated: false },
  ban:           { str: "<:ban:1517488765810114560>",         id: "1517488765810114560", name: "ban",          animated: false },
  mute:          { str: "<:mute:1517478340079124571>",        id: "1517478340079124571", name: "mute",         animated: false },
  mute_icon:     { str: "<:mute:1517478340079124571>",        id: "1517478340079124571", name: "mute",         animated: false },
  nuke:          { str: "<:nuke:1517479972652974130>",        id: "1517479972652974130", name: "nuke",         animated: false },
  termination:   { str: "<:terminate:1517478113146044466>",   id: "1517478113146044466", name: "terminate",    animated: false },
  demotion:      { str: "<:demotion:1517479292886454362>",    id: "1517479292886454362", name: "demotion",     animated: false },
  promotion:     { str: "<:promotion:1517469578916135043>",   id: "1517469578916135043", name: "promotion",    animated: false },
  // ── UI / Info ────────────────────────────────────────────────────────────
  information:   { str: "<:notepad:1517488940381376512>",     id: "1517488940381376512", name: "notepad",      animated: false },
  link:          { str: "<:link:1517488885892907158>",        id: "1517488885892907158", name: "link",         animated: false },
  link_icon:     { str: "<:link:1517488885892907158>",        id: "1517488885892907158", name: "link",         animated: false },
  notifications: { str: "<:notification:1517468727627743273>",id: "1517468727627743273", name: "notification", animated: false },
  announce:      { str: "<:notification:1517468727627743273>",id: "1517468727627743273", name: "notification", animated: false },
  settings:      { str: "<:automod:1517468917755412634>",     id: "1517468917755412634", name: "automod",      animated: false },
  automod:       { str: "<:automod:1517468917755412634>",     id: "1517468917755412634", name: "automod",      animated: false },
  locked:        { str: "<:locked:1517468838936051803>",      id: "1517468838936051803", name: "locked",       animated: false },
  folder:        { str: "<:folder:1517488999453954078>",      id: "1517488999453954078", name: "folder",       animated: false },
  clipboard:     { str: "<:clipboard:1517488639888719882>",   id: "1517488639888719882", name: "clipboard",    animated: false },
  delete:        { str: "<:trash:1517479443486998660>",       id: "1517479443486998660", name: "trash",        animated: false },
  trash:         { str: "<:trash:1517479443486998660>",       id: "1517479443486998660", name: "trash",        animated: false },
  ticket:        { str: "<:ticket:1517478211855057018>",      id: "1517478211855057018", name: "ticket",       animated: false },
  level:         { str: "<:level:1517480037719212032>",       id: "1517480037719212032", name: "level",        animated: false },
  chart:         { str: "<:level:1517480037719212032>",       id: "1517480037719212032", name: "level",        animated: false },
  // ── Shop ─────────────────────────────────────────────────────────────────
  cash:          { str: "<:moneybag:1517479040553062400>",    id: "1517479040553062400", name: "moneybag",     animated: false },
  cashout:       { str: "<:moneybag:1517479040553062400>",    id: "1517479040553062400", name: "moneybag",     animated: false },
  ltc:           { str: "<:moneybag:1517479040553062400>",    id: "1517479040553062400", name: "moneybag",     animated: false },
  shoppingcart:  { str: "<:deal:1517469922630963241>",        id: "1517469922630963241", name: "deal",         animated: false },
  discount:      { str: "<:deal:1517469922630963241>",        id: "1517469922630963241", name: "deal",         animated: false },
  limited:       { str: "<:star:1517489066579333130>",        id: "1517489066579333130", name: "star",         animated: false },
  star:          { str: "<:star:1517489066579333130>",        id: "1517489066579333130", name: "star",         animated: false },
  star_rating:   { str: "<:star:1517489066579333130>",        id: "1517489066579333130", name: "star",         animated: false },
  heart:         { str: "<:soulmate:1517469827852144730>",    id: "1517469827852144730", name: "soulmate",     animated: false },
  chat:          { str: "<:dm_sent:1517480357090295898>",     id: "1517480357090295898", name: "dm_sent",      animated: false },
  // ── Games / Fun ──────────────────────────────────────────────────────────
  giveaway:      { str: "<:giveaway:1517478245233201242>",    id: "1517478245233201242", name: "giveaway",     animated: false },
  trophy:        { str: "<:trophy:1517479909818236958>",      id: "1517479909818236958", name: "trophy",       animated: false },
  dead:          { str: "<:dead:1517469705709817948>",        id: "1517469705709817948", name: "dead",         animated: false },
  streak:        { str: "<:streak:1517478143642832996>",      id: "1517478143642832996", name: "streak",       animated: false },
  eightball:     { str: "<:8ball:1517479634873352304>",       id: "1517479634873352304", name: "8ball",        animated: false },
  luck:          { str: "<:luck:1517468770069778583>",        id: "1517468770069778583", name: "luck",         animated: false },
  fortune:       { str: "<:luck:1517468770069778583>",        id: "1517468770069778583", name: "luck",         animated: false },
  no_luck_face:  { str: "<:luck:1517468770069778583>",        id: "1517468770069778583", name: "luck",         animated: false },
  scramble:      { str: "<:scrambled:1517479371949080606>",   id: "1517479371949080606", name: "scrambled",    animated: false },
  scrambled:     { str: "<:scrambled:1517479371949080606>",   id: "1517479371949080606", name: "scrambled",    animated: false },
  ship:          { str: "<:ship:1517480289142571059>",        id: "1517480289142571059", name: "ship",         animated: false },
  ship_header:   { str: "<:ship:1517480289142571059>",        id: "1517480289142571059", name: "ship",         animated: false },
  ship_filled:   { str: "<:ship:1517480289142571059>",        id: "1517480289142571059", name: "ship",         animated: false },
  ship_empty:    { str: "<:soulmate:1517469827852144730>",    id: "1517469827852144730", name: "soulmate",     animated: false },
  soulmates:     { str: "<:soulmate:1517469827852144730>",    id: "1517469827852144730", name: "soulmate",     animated: false },
  soulmate:      { str: "<:soulmate:1517469827852144730>",    id: "1517469827852144730", name: "soulmate",     animated: false },
  soulmates_ring:{ str: "<:soulmate:1517469827852144730>",    id: "1517469827852144730", name: "soulmate",     animated: false },
  dm_sent:       { str: "<:dm_sent:1517480357090295898>",     id: "1517480357090295898", name: "dm_sent",      animated: false },
  outgoing:      { str: "<:dm_sent:1517480357090295898>",     id: "1517480357090295898", name: "dm_sent",      animated: false },
  incoming:      { str: "<:dm_sent:1517480357090295898>",     id: "1517480357090295898", name: "dm_sent",      animated: false },
  rank1:         { str: "<:1stplace:1517469323059265658>",    id: "1517469323059265658", name: "1stplace",     animated: false },
  rank2:         { str: "<:2ndplace:1517479173147463821>",    id: "1517479173147463821", name: "2ndplace",     animated: false },
  rank3:         { str: "<:3rdplace:1517488699255029760>",    id: "1517488699255029760", name: "3rdplace",     animated: false },
  slots:         { str: "<:slotmachine:1517489125572477118>", id: "1517489125572477118", name: "slotmachine",  animated: false },
  slotmachine:   { str: "<:slotmachine:1517489125572477118>", id: "1517489125572477118", name: "slotmachine",  animated: false },
  bullseye:      { str: "<:gun:1517469636059332618>",         id: "1517469636059332618", name: "gun",          animated: false },
  roulette:      { str: "<:gun:1517469636059332618>",         id: "1517469636059332618", name: "gun",          animated: false },
  gun:           { str: "<:gun:1517469636059332618>",         id: "1517469636059332618", name: "gun",          animated: false },
  // ── Misc UI (no custom version — keep unicode for game boards only) ───────
  draw:          { str: "🤝",  id: "", name: "draw",         animated: false },
  stop:          { str: "🛑",  id: "", name: "stop",         animated: false },
  media:         { str: "<:clipboard:1517488639888719882>",   id: "1517488639888719882", name: "clipboard",    animated: false },
  prank:         { str: "<:luck:1517468770069778583>",        id: "1517468770069778583", name: "luck",         animated: false },
  upvote:        { str: "<:tick:1517479233784643634>",        id: "1517479233784643634", name: "tick",         animated: false },
  rope:          { str: "<:locked:1517468838936051803>",      id: "1517468838936051803", name: "locked",       animated: false },
  transcript:    { str: "<:notepad:1517488940381376512>",     id: "1517488940381376512", name: "notepad",      animated: false },
  launch:        { str: "<:promotion:1517469578916135043>",   id: "1517469578916135043", name: "promotion",    animated: false },
  users_icon:    { str: "<:trget:1517468874440970250>",       id: "1517468874440970250", name: "trget",        animated: false },
  key_icon:      { str: "<:admin:1517469748403896423>",       id: "1517469748403896423", name: "admin",        animated: false },
  edit_icon:     { str: "<:notepad:1517488940381376512>",     id: "1517488940381376512", name: "notepad",      animated: false },
  recycle:       { str: "<:automod:1517468917755412634>",     id: "1517468917755412634", name: "automod",      animated: false },
  spam:          { str: "<:nuke:1517479972652974130>",        id: "1517479972652974130", name: "nuke",         animated: false },
  badwords:      { str: "<:ban:1517488765810114560>",         id: "1517488765810114560", name: "ban",          animated: false },
  mentions_icon: { str: "<:notification:1517468727627743273>",id: "1517468727627743273", name: "notification", animated: false },
  attach:        { str: "<:link:1517488885892907158>",        id: "1517488885892907158", name: "link",         animated: false },
  location:      { str: "<:trget:1517468874440970250>",       id: "1517468874440970250", name: "trget",        animated: false },
  thinking:      { str: "<:8ball:1517479634873352304>",       id: "1517479634873352304", name: "8ball",        animated: false },
  // ── Connect 4 (game board — keep unicode visuals) ─────────────────────────
  c4_red:        { str: "🔴",  id: "", name: "c4_red",       animated: false },
  c4_yellow:     { str: "🟡",  id: "", name: "c4_yellow",    animated: false },
  c4_empty:      { str: "⚫",  id: "", name: "c4_empty",     animated: false },
  // ── Slot reels (game symbols — keep unicode) ──────────────────────────────
  slot_cherry:   { str: "🍒",  id: "", name: "slot_cherry",  animated: false },
  slot_lemon:    { str: "🍋",  id: "", name: "slot_lemon",   animated: false },
  slot_grape:    { str: "🍇",  id: "", name: "slot_grape",   animated: false },
  slot_bell:     { str: "🔔",  id: "", name: "slot_bell",    animated: false },
  slot_diamond:  { str: "💎",  id: "", name: "slot_diamond", animated: false },
  slot_seven:    { str: "7️⃣", id: "", name: "slot_seven",   animated: false },
  jackpot:       { str: "<:giveaway:1517478245233201242>",    id: "1517478245233201242", name: "giveaway",     animated: false },
  big_win:       { str: "<:trophy:1517479909818236958>",      id: "1517479909818236958", name: "trophy",       animated: false },
  small_win:     { str: "<:bluetick:1517479805388591226>",    id: "1517479805388591226", name: "bluetick",     animated: false },
  // ── RPS ──────────────────────────────────────────────────────────────────
  rps_rock:      { str: "🪨",  id: "", name: "rps_rock",     animated: false },
  rps_paper:     { str: "📄",  id: "", name: "rps_paper",    animated: false },
  rps_scissors:  { str: "✂️", id: "", name: "rps_scissors", animated: false },
  rps_win:       { str: "<:bluetick:1517479805388591226>",    id: "1517479805388591226", name: "bluetick",     animated: false },
} as const;

/** Semantic aliases — all resolve to CE custom emojis. */
export const EMOJI = {
  ok:        CE.success.str,
  fail:      CE.error.str,
  warn:      CE.warning.str,
  info:      CE.information.str,
  loading:   CE.loading.str,
  shield:    CE.admin.str,
  crown:     CE.owner.str,
  star:      CE.staff.str,
  fire:      CE.streak.str,
  bomb:      CE.nuke.str,
  rocket:    CE.promotion.str,
  user:      CE.members.str,
  users:     CE.members.str,
  role:      CE.staff.str,
  channel:   CE.settings.str,
  ping:      CE.notifications.str,
  list:      CE.clipboard.str,
  clock:     CE.information.str,
  cal:       CE.information.str,
  msg:       CE.dm_sent.str,
  hammer:    CE.ban.str,
  tools:     CE.settings.str,
  gear:      CE.settings.str,
  ban:       CE.ban.str,
  mute:      CE.mute.str,
  unmute:    CE.check.str,
  kick:      CE.gun.str,
  bell:      CE.notifications.str,
  lock:      CE.locked.str,
  unlock:    CE.check.str,
  bot:       CE.settings.str,
  server:    CE.admin.str,
  globe:     CE.link.str,
  link:      CE.link.str,
  arrowUp:   CE.promotion.str,
  arrowDown: CE.demotion.str,
  bullet:    "•",
  dot:       "·",
  spark:     CE.success.str,
  trophy:    CE.trophy.str,
  graph:     CE.level.str,
  party:     CE.giveaway.str,
} as const;

export function buildBullets(items: { label: string; value: string }[]): string {
  return items.map(f => `> **${f.label}:** ${f.value}`).join("\n");
}

export interface PrettyEmbedOpts {
  title?: string;
  description?: string;
  color?: ColorResolvable;
  fields?: APIEmbedField[];
  footer?: string;
  thumbnail?: string;
  author?: { name: string; iconURL?: string };
  timestamp?: boolean;
  url?: string;
  image?: string;
}

export function prettyEmbed(opts: PrettyEmbedOpts): EmbedBuilder {
  const e = new EmbedBuilder().setColor(opts.color ?? COLORS.primary);
  if (opts.title) e.setTitle(opts.title);
  if (opts.description) e.setDescription(opts.description);
  if (opts.fields && opts.fields.length > 0) e.addFields(opts.fields);
  if (opts.footer) e.setFooter({ text: opts.footer });
  if (opts.thumbnail) e.setThumbnail(opts.thumbnail);
  if (opts.author) e.setAuthor(opts.author);
  if (opts.url) e.setURL(opts.url);
  if (opts.image) e.setImage(opts.image);
  if (opts.timestamp !== false) e.setTimestamp(new Date());
  return e;
}

export function successEmbed(title: string, description?: string): EmbedBuilder {
  return prettyEmbed({
    title: `${CE.success.str} ${title}`,
    description: description ? `> ${description}` : undefined,
    color: COLORS.success,
  });
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  return prettyEmbed({
    title: `${CE.error.str} ${title}`,
    description: description ? `> ${description}` : undefined,
    color: COLORS.danger,
  });
}

export function warnEmbed(title: string, description?: string): EmbedBuilder {
  return prettyEmbed({
    title: `${CE.warning.str} ${title}`,
    description: description ? `> ${description}` : undefined,
    color: COLORS.warning,
  });
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  return prettyEmbed({
    title: `${CE.information.str} ${title}`,
    description: description ? `> ${description}` : undefined,
    color: COLORS.info,
  });
}

export interface ModActionOpts {
  action: string;
  target: { tag: string; id: string; displayAvatarURL: (opts?: any) => string };
  moderator?: { tag: string; id: string };
  reason?: string;
  duration?: string;
  color?: ColorResolvable;
  emoji?: string;
  extraFields?: { label: string; value: string }[];
}

export function modActionEmbed(opts: ModActionOpts): EmbedBuilder {
  const e = new EmbedBuilder()
    .setAuthor({ name: `${opts.action} | ${opts.target.tag}`, iconURL: opts.target.displayAvatarURL({ size: 128 }) })
    .setColor(opts.color ?? COLORS.danger)
    .setDescription(
      buildBullets([
        { label: "Target", value: `<@${opts.target.id}> (\`${opts.target.id}\`)` },
        ...(opts.moderator ? [{ label: "Moderator", value: `<@${opts.moderator.id}>` }] : []),
        ...(opts.duration ? [{ label: "Duration", value: opts.duration }] : []),
        { label: "Reason", value: opts.reason || "No reason provided." },
        ...(opts.extraFields || [])
      ])
    )
    .setFooter({ text: "Relosta Bot • Moderation" })
    .setTimestamp(new Date());
    
  if (opts.emoji) {
    e.setTitle(`${opts.emoji} Action Executed`);
  }
  return e;
}

export interface UserActionOpts {
  title: string;
  target: { tag: string; id: string; displayAvatarURL: (opts?: any) => string };
  description?: string;
  fields?: { label: string; value: string }[];
  color?: ColorResolvable;
  emoji?: string;
  footer?: string;
}

export function userActionEmbed(opts: UserActionOpts): EmbedBuilder {
  const e = new EmbedBuilder()
    .setAuthor({ name: opts.target.tag, iconURL: opts.target.displayAvatarURL({ size: 128 }) })
    .setTitle(`${opts.emoji ? opts.emoji + ' ' : ''}${opts.title}`)
    .setColor(opts.color ?? COLORS.primary);
    
  let desc = "";
  if (opts.description) desc += opts.description + "\n\n";
  if (opts.fields && opts.fields.length > 0) {
    desc += buildBullets(opts.fields);
  }
  if (desc) e.setDescription(desc);
  
  if (opts.footer) {
    e.setFooter({ text: opts.footer });
  }
  
  e.setTimestamp(new Date());
  return e;
}
