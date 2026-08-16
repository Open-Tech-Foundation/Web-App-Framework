// Shared "collapse all / expand all" state for the docs sidebar tree.
//
// The button lives in <Sidebar>, but the open/closed state lives in each <SidebarNode>,
// so the two are coupled through this module-scope signal rather than by prop-drilling
// through a recursive tree (the same decoupling the drawer uses for the navbar burger).
// Every group node runs an effect on `collapseAll.command`; the button flips it.
//
// State is per-session only, like the per-node default — a reload starts over. It does
// persist across SPA navigation, so a collapsed tree stays collapsed while you read
// (except the branch holding the active route, which SidebarNode always keeps open).

import { signal } from "@opentf/web";

// `{ expanded, seq }`. `seq` makes every press a distinct value so the effect re-runs:
// expanding one group by hand and pressing "collapse all" again must re-collapse it.
const command = signal(null);
let seq = 0;

export const collapseAll = {
  /** The last command, or `null` when the tree is still at its derived default. */
  get command() {
    return command.value;
  },
  /** True while "collapse all" is in effect — drives the button's icon and label. */
  get collapsed() {
    const c = command.value;
    return !!c && !c.expanded;
  },
  /** Broadcast `expanded` to every group node. */
  set(expanded) {
    command.value = { expanded, seq: (seq += 1) };
  },
  /** Drop the command; nodes fall back to their derived default. For tests. */
  reset() {
    command.value = null;
    seq = 0;
  },
};
