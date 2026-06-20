// Lifecycle hooks. `onMount`/`onCleanup` are compiler macros: the OpenTF
// compiler collects their callbacks and wires them into a component's
// connect/disconnect (Custom Element) or a page/layout factory's `__lifecycle`
// record. These exports exist so the source-level `import { onMount } from
// "@opentf/web"` resolves, and so calling them outside a compiled component (or
// during SSR) is a safe no-op rather than a crash.

export function onMount() {}
export function onCleanup() {}
