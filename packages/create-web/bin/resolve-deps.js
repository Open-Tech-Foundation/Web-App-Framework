const OTF_SCOPE = "@opentf/";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

function registryBase() {
  return process.env.CREATE_WEB_NPM_REGISTRY?.replace(/\/$/, "") || DEFAULT_REGISTRY;
}
const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/** @param {string} name */
function registryLatestUrl(name) {
  const encoded = name.startsWith("@") ? name.replace("/", "%2f") : name;
  return `${registryBase()}/${encoded}/latest`;
}

/** @param {string} name */
export async function fetchLatestVersion(name) {
  const res = await fetch(registryLatestUrl(name), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${name}: npm registry returned ${res.status}`);
  const data = await res.json();
  if (!data?.version) throw new Error(`${name}: npm registry response missing version`);
  return data.version;
}

/**
 * Collect every `@opentf/*` package referenced in a package.json manifest.
 * @param {Record<string, unknown>} pkg
 */
export function listOpentfDeps(pkg) {
  const names = new Set();
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") continue;
    for (const name of Object.keys(deps)) {
      if (name.startsWith(OTF_SCOPE)) names.add(name);
    }
  }
  return [...names];
}

/**
 * Pin each `@opentf/*` dependency in `pkg` to `^<latest>` from the npm registry.
 * Throws if any lookup fails (scaffolding must not ship stale template ranges).
 *
 * @param {Record<string, unknown>} pkg
 * @param {{ onResolved?: (name: string, version: string) => void }} [opts]
 */
export async function pinOpentfDeps(pkg, opts = {}) {
  if (process.env.CREATE_WEB_SKIP_NPM === "1") return pkg;

  const names = listOpentfDeps(pkg);
  if (!names.length) return pkg;

  const latest = new Map(
    await Promise.all(names.map(async (name) => [name, await fetchLatestVersion(name)])),
  );

  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") continue;
    for (const name of Object.keys(deps)) {
      const version = latest.get(name);
      if (!version) continue;
      deps[name] = `^${version}`;
      opts.onResolved?.(name, version);
    }
  }

  return pkg;
}