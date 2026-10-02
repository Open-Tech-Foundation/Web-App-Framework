// Server metadata resolution accepts eager modules and lazy route loaders.
import { layoutChain, resolveModule } from "../runtime/router.js";
import { resolveMetadataModules } from "../core/metadata.js";
export { renderHead, localeAlternateLinks } from "../core/metadata.js";

export async function resolveMetadata({ route, entry, params = {}, query = {}, layouts = layoutChain(route) } = {}) {
  const modules = await Promise.all([...layouts, entry].map(resolveModule));
  return resolveMetadataModules(modules, { params, query });
}
