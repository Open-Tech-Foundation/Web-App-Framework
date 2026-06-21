export default function Home() {
  let count = $state(0);

  return (
    <section class="card">
      <h1 class="title">Welcome to OpenTF Web</h1>
      <p class="lead">
        A native-first framework: JSX compiles to Web Components with fine-grained,
        signal-based reactivity — no virtual DOM.
      </p>
      <button class="btn" onclick={() => count++}>
        Clicked {count} {count === 1 ? "time" : "times"}
      </button>
      <p class="hint">
        Edit <code class="code">app/page.jsx</code> and save — the page reloads.
      </p>
    </section>
  );
}
