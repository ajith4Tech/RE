// A small, deliberately conservative profanity filter for word-cloud answers.
// Used on phones (instant feedback) and in the Worker (the real check).
// Everything still goes through the moderator's approval queue as well.
const WORDS = [
  // English
  "fuck", "fuk", "fck", "shit", "bitch", "bastard", "asshole", "arsehole", "dick", "cock", "cunt", "pussy", "slut", "whore", "wanker", "twat", "motherfucker", "retard", "nigger", "nigga", "faggot", "fag", "porn", "rape",
  // Hindi / Urdu (romanised)
  "chutiya", "chutia", "chootiya", "madarchod", "madarchot", "behenchod", "bhenchod", "benchod", "bhosdi", "bhosdike", "bhosda", "gandu", "gaand", "randi", "harami", "haramzada", "lund", "lauda", "loda", "kutta", "kutti", "kamina", "jhant", "chod",
  // Devanagari
  "चूतिया", "मादरचोद", "बहनचोद", "भोसड़ी", "गांडू", "रंडी", "हरामी", "लंड", "कमीना",
];
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s" };

export function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .normalize("NFC");
}

export function isProfane(text) {
  const t = normalise(text);
  const squashed = t.replace(/[^\p{L}\p{M}]+/gu, "");
  const words = t.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  return WORDS.some((w) => words.includes(w) || (w.length >= 5 && squashed.includes(w)));
}
