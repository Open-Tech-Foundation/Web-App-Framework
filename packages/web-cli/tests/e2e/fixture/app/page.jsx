import Card from "./Card.jsx";
import Stepper from "./Stepper.jsx";
import Tree from "./Tree.jsx";
import Pill from "./Pill.jsx";

// A recursive tree with both leaf links (a path) and a group (no path, with children) —
// exercises the eagerly-defined <Link> island, a component {children} slot, a conditional
// branch, and per-node rich props across recursion, all at once (the sidebar shape).
const TREE = {
  title: "Root",
  items: [
    { title: "Alpha", path: "/a" },
    {
      title: "Group",
      items: [
        { title: "Bravo", path: "/b" },
        { title: "Charlie", path: "/c" },
      ],
    },
  ],
};

export default function Home() {
  let count = $state(0);
  let items = $state([1, 2, 3]);
  let open = $state(true);
  return (
    <main>
      <h1>E2E_HOME</h1>
      <p>count {count}</p>
      <button onclick={() => count++}>inc</button>
      <Stepper config={{ label: "Steps" }} />
      <button class="add" onclick={() => (items = [...items, items.length + 1])}>add</button>
      <ul class="items">
        {items.map((x) => (
          <li>item {x}</li>
        ))}
      </ul>
      <button class="toggle" onclick={() => (open = !open)}>toggle</button>
      <div class="cond">{open ? <p class="yes">YES</p> : <span class="no">NO</span>}</div>
      <Card>
        <button class="slotted" onclick={() => count++}>slotted {count}</button>
      </Card>
      <div class="pill-host"><Pill on={true} /></div>
      <ul class="tree">
        <Tree node={TREE} />
      </ul>
    </main>
  );
}
