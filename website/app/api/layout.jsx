// API section layout — a standalone reference with its own sidebar, separate from the
// main docs. The marketing navbar/footer come from the root site layout
// (app/layout.jsx), so this renders with `frame={false}`.
//
// The sidebar is just a plain nav tree handed to DocsLayout — no generator needed for a
// short, stable list. Add a page → add a line here. (Shape: `{ title, path?, items? }`,
// the same nodes the docs sidebar uses.)

import { DocsLayout } from "@opentf/web-docs";
import config from "../../otfw.config.js";

const nav = [
  { title: "Overview", path: "/api" },
  { title: "Core", path: "/api/core" },
  { title: "Reactive Macros", path: "/api/macros" },
  { title: "CLI", path: "/api/cli" },
  { title: "web-form", path: "/api/web-form" },
  { title: "web-test", path: "/api/web-test" },
  { title: "web-docs", path: "/api/web-docs" },
];

export default function ApiLayoutRoute(props) {
  return (
    <DocsLayout config={config.docs} nav={nav} frame={false}>
      {props.children}
    </DocsLayout>
  );
}
