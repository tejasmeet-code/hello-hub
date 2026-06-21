/**
 * AI Automod — local content classifier (no external API key required).
 *
 * Uses a layered heuristic engine:
 *   Layer 1 — Exact / substring match against a curated toxic-pattern list
 *   Layer 2 — Regex threat / harassment patterns
 *   Layer 3 — Severity-weighted scoring
 *
 * Fully offline. Users can whitelist words to prevent false positives.
 */

export type ToxicCategory =
  | "hate_speech"
  | "threat"
  | "harassment"
  | "slur"
  | "explicit"
  | "self_harm"
  | "safe";

export interface AiAutomodResult {
  flagged: boolean;
  category: ToxicCategory;
  confidence: number;       // 0-100
  matchedPattern?: string;  // what triggered the flag (sanitised for logging)
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern tables
// ─────────────────────────────────────────────────────────────────────────────

/** Regex-based threat patterns */
const THREAT_REGEXES: RegExp[] = [
  /i('ll|m going to|will)\s+(kill|murder|hurt|attack|stab|shoot|bomb|destroy)\s+(you|u|him|her|them)/i,
  /\b(kill\s*your\s*self|kys)\b/i,
  /\b(i('ll| will) (find|locate) (you|u|where you live))\b/i,
  /\b(swat(ting)?|dox(x)?ing|leak(ing)? (your|ur) (ip|address|location|info))\b/i,
  /\b(bomb\s*threat|school\s*shooting|mass\s*shooting)\b/i,
  /gonna\s+(kill|murder|hurt|stab|shoot)\s+(you|u|him|her|them)/i,
  /\b(i will (end|destroy) you)\b/i,
  /\b(watch your back)\b/i,
];

/** Self-harm patterns */
const SELF_HARM_REGEXES: RegExp[] = [
  /\b(want\s*to\s*(die|end\s*it|kill\s*myself|suicide))\b/i,
  /\b(how\s*to\s*(kill\s*yourself|commit\s*suicide|overdose))\b/i,
  /\b(cutting\s*myself|self\s*harm)\b/i,
];

/**
 * Explicit profanity patterns — checked on normalised text.
 * No word boundaries: profanity can be embedded inside other text.
 */
const EXPLICIT_REGEXES: RegExp[] = [
  // Common profanity (covers raw + l33t + asterisk obfuscation after normalise)
  /f[u*]c?k(ing|er|ers|ed|s)?/i,
  /sh[i*]t(ty|ter|s|face)?/i,
  /[a@]ss(hole|hat|wipe|face|clown|head|s)?/i,
  /b[i*]tch(es|y|ing|ass)?/i,
  /c[o0u*]ck(sucker|s)?/i,
  /d[i*1]ck(head|s|face)?/i,
  /p[u*]ss[yi](es)?/i,
  /c[u*]nt(s|y)?/i,
  /wh[o0]re(s|y)?/i,
  /sl[u*]t(s|ty)?/i,
  /b[a@]st[a@]rd/i,
  /m[o0]th[e3]r\s*f[u*]c?k/i,
  /cr[a@]p(py|s)?/i,
  /[a@]ss\s*f[u*]c?k/i,
];

/** Hate speech patterns — ideological hostility targeting protected groups */
const HATE_SPEECH_REGEXES: RegExp[] = [
  /(i\s*hate\s*(all\s*)?(black|white|jewish|muslim|gay|trans|asian|hispanic|latino|arab)\s*(people|persons|men|women|community))/i,
  /(all\s*(jews|blacks|muslims|gays|trans|asians|hispanics)\s*(should|deserve|must|need\s*to)\s*(die|be\s*(killed|banned|deported|eliminated)))/i,
  /(white\s*supremac|ethnic\s*cleansing|racial\s*purity|race\s*war|master\s*race|sub[\s-]?human)/i,
  /(death\s*to\s*(all\s*)?(jews|muslims|blacks|gays|trans|christians))/i,
  /(gas\s*the|send\s*them\s*back|replace\s*the\s*whites|great\s*replacement)/i,
];

/** Harassment patterns */
const HARASSMENT_REGEXES: RegExp[] = [
  /\b(you('re|\s*are)\s*(worthless|pathetic|garbage|trash|disgusting|a\s*(loser|idiot|moron|retard|waste)))\b/i,
  /\b(no\s*one\s*(likes|wants|cares\s*about)\s*you)\b/i,
  /\b(go\s*(die|kill\s*yourself|away\s*forever))\b/i,
  /\b(you\s*should\s*(die|not\s*exist|kill\s*yourself))\b/i,
  /\b(nobody\s*(loves|likes|wants)\s*you)\b/i,
];

// Curated slur stems — normalise l33t speak before checking
const SLUR_STEMS: string[] = [
  "nigg", "n1gg",
  "fagg", "f4gg",
  "chink", "ch1nk",
  "spic", "sp1c",
  "kike", "k1ke",
  "trann", "tr4nn",
  "wetbac",
  "beaner",
  "towelhead",
  "sandnig",
  "gooks",
  "cracker",
  "honkey",
  "coon",
  "porch",
];

// ─────────────────────────────────────────────────────────────────────────────
// Normaliser — collapse l33t speak so filters can't be bypassed easily
// Note: asterisks (*) are intentionally NOT stripped so patterns like
// f*ck / sh*t remain detectable via the explicit regex character classes.
// ─────────────────────────────────────────────────────────────────────────────
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/\$/g, "s")
    .replace(/[@]/g, "a")
    .replace(/[-\\.]/g, "")          // strip hyphens and dots (NOT asterisks)
    .replace(/(.)\1{2,}/g, "$1$1");  // collapse 3+ repeated chars (fuuuuck → fuuck)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main classifier
// ─────────────────────────────────────────────────────────────────────────────
export function classifyContent(
  text: string,
  whitelist: string[] = [],
): AiAutomodResult {
  if (!text || text.trim().length === 0) {
    return { flagged: false, category: "safe", confidence: 0 };
  }

  const norm = normalise(text);

  // Whitelisted words are stripped from the normalised text before analysis
  let analysed = norm;
  for (const w of whitelist) {
    analysed = analysed.replace(new RegExp(normalise(w), "gi"), "");
  }

  // Layer 1 — Threat check (highest priority)
  for (const re of THREAT_REGEXES) {
    if (re.test(analysed)) {
      return { flagged: true, category: "threat", confidence: 95, matchedPattern: "threat_pattern" };
    }
  }

  // Layer 2 — Self-harm
  for (const re of SELF_HARM_REGEXES) {
    if (re.test(analysed)) {
      return { flagged: true, category: "self_harm", confidence: 90, matchedPattern: "self_harm_pattern" };
    }
  }

  // Layer 3 — Slurs
  for (const stem of SLUR_STEMS) {
    if (analysed.includes(stem)) {
      return { flagged: true, category: "slur", confidence: 88, matchedPattern: "slur_pattern" };
    }
  }

  // Layer 4 — Hate Speech
  for (const re of HATE_SPEECH_REGEXES) {
    if (re.test(analysed)) {
      return { flagged: true, category: "hate_speech", confidence: 88, matchedPattern: "hate_speech_pattern" };
    }
  }

  // Layer 5 — Harassment
  for (const re of HARASSMENT_REGEXES) {
    if (re.test(analysed)) {
      return { flagged: true, category: "harassment", confidence: 80, matchedPattern: "harassment_pattern" };
    }
  }

  // Layer 6 — Explicit profanity
  for (const re of EXPLICIT_REGEXES) {
    if (re.test(analysed)) {
      return { flagged: true, category: "explicit", confidence: 78, matchedPattern: "explicit_pattern" };
    }
  }

  return { flagged: false, category: "safe", confidence: 0 };
}

/** Human-readable label for a category */
export function categoryLabel(cat: ToxicCategory): string {
  switch (cat) {
    case "hate_speech":  return "Hate Speech";
    case "threat":       return "Threat";
    case "harassment":   return "Harassment";
    case "slur":         return "Slur";
    case "explicit":     return "Explicit Content";
    case "self_harm":    return "Self-Harm Content";
    default:             return "Safe";
  }
}
