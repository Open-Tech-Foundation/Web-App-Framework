// Estimate a post's reading time (minutes) from its Markdown source. Strips
// frontmatter, code, HTML/JSX tags, and Markdown punctuation before counting words,
// then divides by `wpm` (200 words/min ≈ average adult prose reading). Build-time
// only — the result ships as data on each post (see blog-posts-plugin.js).
export function readingTime(source, wpm = 200) {
  const body = String(source || "")
    .replace(/^﻿?---\r?\n[\s\S]*?\r?\n---/, "") // frontmatter
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/<[^>]+>/g, " ") // html / jsx tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/[#>*_~`\-]+/g, " "); // residual md punctuation
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / wpm));
}
