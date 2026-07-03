export default function Home() {
  let count = $state(0);

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
    </section>
  );
}
