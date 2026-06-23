// Generic tabbed panel. `tabs` is an array of `{ label, content }`. `content` is
// rendered as-is: a string is plain text, a node is the node. For a code panel with a
// copy button, pass a `CodeBlock`: `{ label, content: <CodeBlock code="…" /> }`.
//
//   <Tabs tabs={[{ label: "npm", content: <CodeBlock code="npm i …" /> }, …]} />

export default function Tabs(props) {
  let active = $state(0);
  const tabs = props.tabs || [];

  return (
    <div class="otfw-tabs">
      <div class="otfw-tabs-list" role="tablist">
        {tabs.map((tab, i) => (
          <button
            class={active === i ? "otfw-tab otfw-active" : "otfw-tab"}
            onclick={() => (active = i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div class="otfw-tabs-panels">
        {tabs.map((tab, i) => (
          <div class={active === i ? "otfw-tab-panel" : "otfw-tab-panel otfw-hidden"}>
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
}
