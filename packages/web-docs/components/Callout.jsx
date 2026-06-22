// Admonition / callout box. `type` is note | tip | info | warning | danger.
//
//   <Callout type="warning" title="Heads up">…</Callout>

const ICONS = {
  note: "✎",
  tip: "💡",
  info: "ℹ",
  warning: "⚠",
  danger: "⛔",
};

export default function Callout(props) {
  const type = props.type || "note";
  const title = props.title || type.charAt(0).toUpperCase() + type.slice(1);
  const icon = ICONS[type] || ICONS.note;

  return (
    <div class={"otfw-callout otfw-callout-" + type}>
      <div class="otfw-callout-title">
        <span class="otfw-callout-icon" aria-hidden="true">
          {icon}
        </span>
        {title}
      </div>
      <div class="otfw-callout-body">{props.children}</div>
    </div>
  );
}
