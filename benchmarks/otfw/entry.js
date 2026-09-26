// Benchmark entry for pure-esdev runs (`esdev start` / `esdev build`).
// The route map comes from the `@otfw/routes` virtual module (file conventions,
// no CLI), components compile on load.
import { mountApp } from "@opentf/web";
import { guard, pages } from "@otfw/routes";

import "./app/global.css";

mountApp({ pages, guard, target: document.getElementById("app") });
