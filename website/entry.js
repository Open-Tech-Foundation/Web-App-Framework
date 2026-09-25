// Website entry for pure-esdev runs (`esdev start` / `esdev build`).
// Four lines: the route map comes from the `@otfw/routes` virtual module
// (file conventions, no CLI), components compile on load. Styles come back
// with esdev's Tailwind support (until then, unstyled but working).
import { mountApp } from "@opentf/web";
import { guard, pages } from "@otfw/routes";

mountApp({ pages, guard, target: document.getElementById("app") });
