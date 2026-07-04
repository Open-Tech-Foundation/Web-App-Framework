export default function Home() {
  let count = $state(0);
  let apiMessage = $state("");

  async function pingApi() {
    try {
      const res = await fetch("/api/hello");
      apiMessage = (await res.json()).message;
    } catch {
      apiMessage = "API unavailable — run `bun run dev` or `bun run serve`.";
    }
  }

  return (
    <section class="welcome">
      <p class="eyebrow">OTF Web</p>
      <h1 class="title">Welcome to your new app</h1>
      <p class="lead">
        Edit <code class="code">app/page.jsx</code> to start building. JSX compiles
        to native DOM operations with fine-grained reactivity.
      </p>
      <button class="btn" onclick={() => count++}>
        Clicked {count} {count === 1 ? "time" : "times"}
      </button>
      <p class="lead">
        This app ships an API route at <code class="code">app/api/hello/route.js</code>.
      </p>
      <button class="btn" onclick={pingApi}>Ping /api/hello</button>
      <p class="lead">{apiMessage}</p>
    </section>
  );
}
