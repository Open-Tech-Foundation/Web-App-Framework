// A <Portal>-wrapped modal whose open/closed state drives a reactive `class` binding —
// the exact shape of the docs navbar search bug. On first paint the parent must adopt the
// portaled modal *in place* (wiring the class binding) BEFORE the portal relocates it to
// <body>; if the portal moved first (pre-fix), the binding was dead and the trigger did
// nothing until a later CSR rebuild. This is the only fixture that exercises custom-element
// upgrade ordering + portal relocation across hydration — a real-browser-only path.

import { Portal } from "@opentf/web";

export default function Search() {
  let open = $state(false);
  return (
    <div class="search">
      <button class="search-trigger" onclick={() => (open = true)}>Search</button>
      <Portal>
        <div class={open ? "search-modal is-open" : "search-modal"}>
          <p class="search-body">modal {open ? "OPEN" : "CLOSED"}</p>
        </div>
      </Portal>
    </div>
  );
}
