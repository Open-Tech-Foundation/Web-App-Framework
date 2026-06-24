// Reading-time label, e.g. "4 min read". `minutes` is precomputed at build time by
// the blog posts plugin (see build/reading-time.js).
export default function ReadingTime(props) {
  const minutes = props.minutes ?? 1;
  return <span class="otfw-reading-time">{minutes} min read</span>;
}
