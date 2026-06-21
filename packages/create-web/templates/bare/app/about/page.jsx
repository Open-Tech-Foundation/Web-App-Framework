import { Link } from "@opentf/web";

export default function About() {
  return (
    <section class="card">
      <h1 class="title">About</h1>
      <p class="lead">
        A second route, rendered by <code class="code">app/about/page.jsx</code>.
        File-based routing: every <code class="code">page.jsx</code> under{" "}
        <code class="code">app/</code> becomes a route.
      </p>
      <Link href="/" class="btn">← Back home</Link>
    </section>
  );
}
