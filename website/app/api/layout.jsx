// API section layout — identical to the docs layout but living under app/api, so it's
// the /api section. DocsLayout sources the generated sidebar and scopes it to /api by
// route; adding another section is just another folder with a layout like this.

import { DocsLayout } from "@opentf/web-docs";
import config from "../../otfw.config.js";

export default function ApiLayoutRoute(props) {
  return (
    <DocsLayout config={config.docs} frame={false}>
      {props.children}
    </DocsLayout>
  );
}
