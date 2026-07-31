// Shapes that look fragile but are not: an `<a>` is closed only by another `<a>` start
// tag, an `<li>` only by another `<li>`. These must keep adopting — `<a>{children}</a>`
// is the Link component, and with it every nav on every page.
export default function Inline() {
  let n = $state(0);
  const items = ["one", "two"];
  return (
    <div class="root">
      <a class="link" href="/x">
        label {n}
      </a>
      <ul class="items">
        {items.map((item) => (
          <li key={item}>
            <a href={"/" + item}>{item}</a>
          </li>
        ))}
      </ul>
      <button class="btn">
        <span>{n}</span>
      </button>
    </div>
  );
}
