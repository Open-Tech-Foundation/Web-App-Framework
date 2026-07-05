import { Link, router } from "@opentf/web";

// A recursive sidebar-shaped island: each node is either a <Link> (a component with a
// {children} slot, eagerly defined by @opentf/web) or a plain group <span>, plus an
// optional nested <ul> of <Tree>s. Driven entirely by the rich `node` object prop, so
// correct hydration depends on (a) the Link adopting instead of build-wrapping its <a>
// and (b) each nested Tree keeping its payload-hydrated `node` prop (not a clobbered
// "[object Object]" attribute that would flip `node.path` and desync the walk).
export default function Tree({ node }) {
  const item = node || {};
  const kids = item.items || [];
  return (
    <li class="tree-node">
      {item.path ? (
        <Link href={item.path} class={router.pathname === item.path ? "tree-link tree-active" : "tree-link"}>
          <span class="tree-dot"></span>
          {item.title}
        </Link>
      ) : (
        <span class="tree-group">{item.title}</span>
      )}
      {kids.length > 0 ? (
        <ul class="tree-sub">
          {kids.map((k) => (
            <Tree node={k} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
