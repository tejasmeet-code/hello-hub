/**
 * Multi-Language Profanity & Masked Word Detector for Automod
 * Detects English, Hindi, Spanish, French, Russian profanity, sensitive terms (diddy, epstein),
 * and masking attempts (f**k, f#ck, f u c k, b!tch, etc.).
 */

const BUILTIN_PROHIBITED_WORDS = [
  // English Profanity & Slurs
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "whore",
  "slut",
  "dick",
  "pussy",
  "bastard",
  "motherfucker",

  // Specific Sensitive / Controversial Terms
  "diddy",
  "epstein",
  "epstien",
  "pedophile",
  "pdfile",
  "rapist",

  // Hindi / Urdu / South Asian Profanity & Slurs
  "madarchod",
  "behenchod",
  "bhosdike",
  "bhosdi",
  "bhosdika",
  "chutiya",
  "chootiya",
  "choot",
  "gaand",
  "gandu",
  "randi",
  "raand",
  "lauda",
  "loda",
  "lawde",
  "lavde",
  "harami",
  "kamina",
  "suar",
  "chotya",
  "bkl",
  "mkl",
  "tatte",
  "jhant",

  // Spanish / French / German / Russian
  "puta",
  "pendejo",
  "cabron",
  "merde",
  "connard",
  "salope",
  "scheisse",
  "cyka",
  "blyat",
];

// Regular expressions to catch masked profanity (e.g., f**k, f#ck, f u c k, b!tch, sh!t)
const MASKED_PATTERNS: Array<{ pattern: RegExp; word: string }> = [
  { pattern: /\bf[\W_0-9]*u[\W_0-9]*c[\W_0-9]*k\b/i, word: "fuck" },
  { pattern: /\bf[\W_0-9]{1,3}k\b/i, word: "f*ck" },
  { pattern: /\bs[\W_0-9]*h[\W_0-9]*i[\W_0-9]*t\b/i, word: "shit" },
  { pattern: /\bb[\W_0-9]*i[\W_0-9]*t[\W_0-9]*c[\W_0-9]*h\b/i, word: "bitch" },
  { pattern: /\bc[\W_0-9]*u[\W_0-9]*n[\W_0-9]*t\b/i, word: "cunt" },
  { pattern: /\bn[\W_0-9]*i[\W_0-9]*g[\W_0-9]*g[\W_0-9]*[a-z]?\b/i, word: "n-word" },
  { pattern: /\bw[\W_0-9]*h[\W_0-9]*o[\W_0-9]*r[\W_0-9]*e\b/i, word: "whore" },
  { pattern: /\bd[\W_0-9]*i[\W_0-9]*d[\W_0-9]*d[\W_0-9]*y\b/i, word: "diddy" },
  { pattern: /\be[\W_0-9]*p[\W_0-9]*s[\W_0-9]*t[\W_0-9]*e?[\W_0-9]*i[\W_0-9]*n\b/i, word: "epstein" },
  { pattern: /\bm[\W_0-9]*a[\W_0-9]*d[\W_0-9]*a[\W_0-9]*r[\W_0-9]*c[\W_0-9]*h[\W_0-9]*o[\W_0-9]*d\b/i, word: "madarchod" },
  { pattern: /\bb[\W_0-9]*e[\W_0-9]*h[\W_0-9]*e[\W_0-9]*n[\W_0-9]*c[\W_0-9]*h[\W_0-9]*o[\W_0-9]*d\b/i, word: "behenchod" },
  { pattern: /\bc[\W_0-9]*h[\W_0-9]*u[\W_0-9]*t[\W_0-9]*i[\W_0-9]*y[\W_0-9]*a\b/i, word: "chutiya" },
];

/**
 * Normalizes text by replacing leetspeak characters and removing obfuscating punctuation.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0o@!$1345#*\-_.]/g, (char) => {
      switch (char) {
        case "@":
        case "4":
          return "a";
        case "1":
        case "!":
        case "|":
          return "i";
        case "0":
          return "o";
        case "3":
          return "e";
        case "$":
        case "5":
          return "s";
        default:
          return "";
      }
    });
}

export function containsProhibitedLanguage(
  content: string,
  customWords: string[] = []
): { prohibited: boolean; word?: string } {
  if (!content || !content.trim()) return { prohibited: false };

  const rawLower = content.toLowerCase();
  const normalized = normalizeText(content);
  const stripped = content.replace(/[\W_]+/g, "").toLowerCase();

  const allWords = [...BUILTIN_PROHIBITED_WORDS, ...customWords.map((w) => w.toLowerCase().trim()).filter(Boolean)];

  // 1. Exact or substring match against raw text or normalized text
  for (const word of allWords) {
    if (
      rawLower.includes(word) ||
      normalized.includes(word) ||
      stripped.includes(word)
    ) {
      return { prohibited: true, word };
    }
  }

  // 2. Check masked regex patterns
  for (const item of MASKED_PATTERNS) {
    if (item.pattern.test(content) || item.pattern.test(rawLower)) {
      return { prohibited: true, word: item.word };
    }
  }

  return { prohibited: false };
}
