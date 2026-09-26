// Website entry for pure-esdev runs (`esdev start` / `esdev build`).
// Four lines: the route map comes from the `@otfw/routes` virtual module
// (file conventions, no CLI), components compile on load, styles compile
// natively (project tailwindcss).
import { mountApp } from "@opentf/web";
import { guard, pages } from "@otfw/routes";

import "./app/global.css";

mountApp({ pages, guard, target: document.getElementById("app") });
