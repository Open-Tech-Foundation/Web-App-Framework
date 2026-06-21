import { Link } from "@opentf/web";

export default function NotFound() {
  return (
    <section class="card">
      <h1 class="title">404</h1>
      <p class="lead">This page could not be found.</p>
      <Link href="/" class="btn">← Back home</Link>
    </section>
  );
}
