/** @typedef {"npm" | "pnpm" | "yarn" | "bun"} PackageManager */

const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/**
 * Detect which package manager invoked this scaffold (`npm create`, `pnpm create`, …).
 * Falls back to `npm` when run directly (e.g. `node bin/index.js`).
 *
 * @returns {PackageManager}
 */
export function detectPackageManager() {
  const override = process.env.CREATE_WEB_PM;
  if (override && MANAGERS.has(override)) return /** @type {PackageManager} */ (override);

  const ua = process.env.npm_config_user_agent ?? "";
  const name = ua.split(" ")[0]?.split("/")[0];
  if (name && MANAGERS.has(name)) return /** @type {PackageManager} */ (name);
  return "npm";
}

/** @param {PackageManager} pm */
export function installCommand(pm) {
  return `${pm} install`;
}

/** @param {PackageManager} pm */
export function devCommand(pm) {
  return `${pm} run dev`;
}