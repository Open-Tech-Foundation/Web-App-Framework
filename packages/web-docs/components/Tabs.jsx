// Generic tabbed panel. `tabs` is an array of `{ label, content }`.
//
//   <Tabs tabs={[{ label: "npm", content: <…/> }, …]} />
//
// String `content` is treated as code and rendered through `CodeBlock`, so the panel
// gets the same header + copy button as a fenced block; pass JSX for anything else.
import CodeBlock from "./CodeBlock.jsx";

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
            {typeof tab.content === "string" ? (
              <CodeBlock code={tab.content} lang={tab.lang} name={tab.name} />
            ) : (
              tab.content
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
