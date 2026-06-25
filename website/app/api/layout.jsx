// API section layout — a standalone reference with its own sidebar, separate from the
// main docs but built from the same parts. It's just another `DocsLayout` branch: it
// imports the shared section map and the layout selects the `/api` tree by route. The
// marketing navbar/footer come from the root site layout, so `frame={false}`.

import { DocsLayout } from "@opentf/web-docs";
import nav from "@opentf/web-docs/nav";
import config from "../../otfw.config.js";

export default function ApiLayoutRoute(props) {
  return (
    <DocsLayout config={config.docs} nav={nav} frame={false}>
      {props.children}
    </DocsLayout>
  );
}
