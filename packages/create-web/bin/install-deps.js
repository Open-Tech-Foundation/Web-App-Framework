import { Command } from "runtime:system";
import { detectPackageManager } from "./detect-pm.js";

/**
 * Run `<pm> install` in `cwd` using the package manager that invoked the scaffolder.
 *
 * @param {string} cwd
 * @param {ReturnType<typeof detectPackageManager>} [pm]
 */
export async function installDependencies(cwd, pm = detectPackageManager()) {
  const result = await new Command(pm, {
    args: ["install"],
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    inheritEnv: true,
  }).output();
  if (!result.success) {
    throw new Error(`${pm} install exited with code ${result.code ?? "unknown"}`);
  }
}
