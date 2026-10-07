// Generic tabbed panel. `tabs` is an array of `{ label, content }`. `content` is
// rendered as-is: a string is plain text, a node is the node. For a code panel with a
// copy button, pass a `CodeBlock`: `{ label, content: <CodeBlock code="…" /> }`.
//
//   <Tabs label="Package manager" tabs={[{ label: "npm", content: <CodeBlock code="npm i …" /> }, …]} />
//
// Follows the WAI-ARIA tabs pattern: one tab stop for the list (roving `tabindex`),
// Arrow Left/Right (wrapping), Home and End move focus and select the tab, and each
// tab names and controls its panel. Ids are assigned on mount so a server-rendered
// tab set and its hydrated copy never disagree.

let instances = 0;

export default function Tabs(props) {
  let active = $state(0);
  let list = $ref();
  const tabs = props.tabs || [];

  onMount(() => {
    const id = `otfw-tabs-${++instances}`;
    const buttons = list.querySelectorAll('[role="tab"]');
    const panels = list.nextElementSibling.children;
    buttons.forEach((button, i) => {
      button.id = `${id}-tab-${i}`;
      button.setAttribute("aria-controls", `${id}-panel-${i}`);
    });
    Array.from(panels).forEach((panel, i) => {
      panel.id = `${id}-panel-${i}`;
      panel.setAttribute("aria-labelledby", `${id}-tab-${i}`);
    });
  });

  function onKeyDown(event) {
    const last = tabs.length - 1;
    const next = {
      ArrowRight: active === last ? 0 : active + 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined || last < 0) return;
    event.preventDefault();
    active = next;
    list.querySelectorAll('[role="tab"]')[next]?.focus();
  }

  return (
    <div class="otfw-tabs">
      <div class="otfw-tabs-list" role="tablist" aria-label={props.label} ref={list} onkeydown={onKeyDown}>
        {tabs.map((tab, i) => (
          <button
            type="button"
            role="tab"
            class={active === i ? "otfw-tab otfw-active" : "otfw-tab"}
            aria-selected={active === i ? "true" : "false"}
            tabindex={active === i ? "0" : "-1"}
            onclick={() => (active = i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div class="otfw-tabs-panels">
        {tabs.map((tab, i) => (
          <div
            role="tabpanel"
            tabindex="0"
            class={active === i ? "otfw-tab-panel" : "otfw-tab-panel otfw-hidden"}
            hidden={active !== i}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
}
