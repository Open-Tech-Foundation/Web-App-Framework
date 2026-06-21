//! Decompress the host's otfwc binary after install. Best-effort: a no-op on a
//! source checkout (no `.br` present) and never throws, so it can't break install.
//! `otfwcPath()` decompresses lazily anyway if this is skipped (--ignore-scripts).

import { extractIfPackaged } from "../extract.js";

extractIfPackaged();
