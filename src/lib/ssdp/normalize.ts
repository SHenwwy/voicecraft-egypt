// Egyptian Arabic text normalization for transcripts and training output.
// Handles: emojis, URLs, repeated chars, Arabic/English digits,
// alef variants, ya/alef-maqsura, ta-marbuta, tatweel, diacritics.

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

const ALEF_VARIANTS = /[\u0622\u0623\u0625]/g; // آ أ إ -> ا
const YA_VARIANTS = /\u0649/g; // ى -> ي
const TA_MARBUTA = /\u0629/g; // ة -> ه (Egyptian colloquial convention)
const TATWEEL = /\u0640/g;
const DIACRITICS = /[\u064B-\u0652\u0670]/g;
// emoji-ish (broad): pictographs + symbols
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu;
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const MULTI_SPACE = /\s+/g;
const REPEATED_CHAR = /(.)\1{2,}/g; // "هههه" -> "هه"

export type NormalizeOptions = {
  keepDiacritics?: boolean;
  keepTaMarbuta?: boolean;
  collapseRepeated?: boolean;
  stripEmoji?: boolean;
  stripUrls?: boolean;
  arabicDigitsToAscii?: boolean;
};

export function normalizeArabic(input: string, opts: NormalizeOptions = {}): string {
  const {
    keepDiacritics = false,
    keepTaMarbuta = false,
    collapseRepeated = true,
    stripEmoji = true,
    stripUrls = true,
    arabicDigitsToAscii = true,
  } = opts;

  let s = input;
  if (stripUrls) s = s.replace(URL_RE, " ");
  if (stripEmoji) s = s.replace(EMOJI, " ");
  if (arabicDigitsToAscii) s = s.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d] ?? d);
  if (!keepDiacritics) s = s.replace(DIACRITICS, "");
  s = s.replace(TATWEEL, "");
  s = s.replace(ALEF_VARIANTS, "ا");
  s = s.replace(YA_VARIANTS, "ي");
  if (!keepTaMarbuta) s = s.replace(TA_MARBUTA, "ه");
  if (collapseRepeated) s = s.replace(REPEATED_CHAR, "$1$1");
  s = s.replace(MULTI_SPACE, " ").trim();
  return s;
}

export function tokenize(text: string): string[] {
  return text
    .split(/[\s\u060C\u061B،.!؟?\-—:;]+/)
    .filter(Boolean);
}

// Levenshtein for WER/CER
export function levenshtein(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j - 1], dp[j]);
      prev = tmp;
    }
  }
  return dp[n];
}

export function wer(ref: string, hyp: string): number {
  const r = tokenize(normalizeArabic(ref));
  const h = tokenize(normalizeArabic(hyp));
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return Math.min(1, levenshtein(r, h) / r.length);
}

export function cer(ref: string, hyp: string): number {
  const r = Array.from(normalizeArabic(ref).replace(/\s+/g, ""));
  const h = Array.from(normalizeArabic(hyp).replace(/\s+/g, ""));
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return Math.min(1, levenshtein(r, h) / r.length);
}
