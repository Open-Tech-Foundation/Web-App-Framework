// Development-mode diagnostics. SPEC §5.4.4 specifies warnings that fire "in
// development mode"; this is the flag they gate on.
//
// `process.env.NODE_ENV` is substituted at bundle time by the toolchain (`otfw
// dev` → "development", `otfw build` → "production"), so DEV folds to a literal
// and every `if (DEV)` block is dropped by minification from production output.
// Under SSR/tests the identifier survives and `process` is real, so the check
// still works.
export const DEV = process.env.NODE_ENV !== "production";

const seen = new Set();

/**
 * Warn once per distinct `key`, so a diagnostic raised from inside an effect
 * (which can re-run on every update) doesn't flood the console. Dev-only: the
 * call sites gate on {@link DEV} so this is unreachable in a production bundle.
 */
export function warnOnce(key, message) {
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(`[@opentf/web] ${message}`);
}

/** Test hook: forget which warnings have fired. */
export function resetWarnings() {
  seen.clear();
}
