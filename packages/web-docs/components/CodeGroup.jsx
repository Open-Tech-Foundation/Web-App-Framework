// Grouped code blocks behind tabs (e.g. npm / pnpm / bun install commands).
// `items` is an array of `{ label, content }` where content is typically a fenced
// code block (already highlighted at build time by the MDX front-end).

export default function CodeGroup(props) {
  let active = $state(0);
  const items = props.items || [];

  return (
    <div class="otfw-codegroup">
      <div class="otfw-codegroup-tabs" role="tablist">
        {items.map((it, i) => (
          <button
            class={active === i ? "otfw-codegroup-tab otfw-active" : "otfw-codegroup-tab"}
            onclick={() => (active = i)}
          >
            {it.label}
          </button>
        ))}
      </div>
      {items.map((it, i) => (
        <div class={active === i ? "otfw-codegroup-panel" : "otfw-codegroup-panel otfw-hidden"}>
          {it.content}
        </div>
      ))}
    </div>
  );
}
