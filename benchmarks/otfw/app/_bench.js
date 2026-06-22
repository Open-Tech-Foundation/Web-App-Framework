// Pure, framework-agnostic benchmark helpers. Copy this file verbatim into a
// sibling framework case so every engine shares identical row data, sample
// counts, and timing — see benchmarks/README.md ("Adding a framework").

const ADJECTIVES = [
  "pretty", "large", "big", "small", "tall", "short", "long", "handsome",
  "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful",
  "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap",
  "expensive", "fancy",
];
const COLOURS = [
  "red", "yellow", "blue", "green", "pink", "brown", "purple", "brown",
  "white", "black", "orange",
];
const NOUNS = [
  "table", "chair", "house", "bbq", "desk", "car", "pony", "cookie",
  "sandwich", "burger", "pizza", "mouse", "keyboard",
];

let nextId = 1;
const pick = (xs) => xs[(Math.random() * xs.length) | 0];

/** Build `count` rows with a fresh monotonic id and a random label. */
export function buildRows(count) {
  const rows = new Array(count);
  for (let i = 0; i < count; i++) {
    rows[i] = {
      id: nextId++,
      label: `${pick(ADJECTIVES)} ${pick(COLOURS)} ${pick(NOUNS)}`,
    };
  }
  return rows;
}

/** Median of a numeric array (does not mutate the input). */
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Resolve after the browser has painted the *next* frame. A double rAF: the
 * first callback fires before paint of the pending frame, the second after it —
 * so a synchronous DOM mutation made just before awaiting this has been
 * committed and painted by the time it resolves.
 */
export function nextFrame() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
