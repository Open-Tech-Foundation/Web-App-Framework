import { createOtfwPlugin } from "./plugin.js";
import { createOtfwRoutes } from "./routes.js";

// The default package entry is the plugin a starter lists in esdev.json.
// Named compiler/routes factories remain available for custom build drivers.
export function createWebPlugin({ appDir = "app", exclude = [], routes = true, failOnError = true, ...options } = {}) {
  if (typeof routes !== "boolean") throw new Error("OTF plugin routes must be a boolean");
  const compiler = createOtfwPlugin({ ...options, failOnError });
  if (!routes) return compiler;
  const routing = createOtfwRoutes({ appDir, exclude });
  return {
    ...compiler,
    resolve: {
      filter: { id: /^(?:@otfw\/routes|@opentf\/web(?:\/runtime)?)$/ },
      handler(source, importer, ctx) {
        return source === "@otfw/routes"
          ? routing.resolve.handler(source, importer)
          : compiler.resolve.handler(source, importer, ctx);
      },
    },
    load: routing.load,
  };
}

export default createWebPlugin;
