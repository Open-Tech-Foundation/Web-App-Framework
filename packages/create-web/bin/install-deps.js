import { spawnSync } from "node:child_process";
import { detectPackageManager } from "./detect-pm.js";

/**
 * Run `<pm> install` in `cwd` using the package manager that invoked the scaffolder.
 *
 * @param {string} cwd
 * @param {ReturnType<typeof detectPackageManager>} [pm]
 */
export function installDependencies(cwd, pm = detectPackageManager()) {
  const result = spawnSync(pm, ["install"], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${pm} install exited with code ${result.status ?? "unknown"}`);
  }
}