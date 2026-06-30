// Public entry for @opentf/web-i18n — ICU messages + Intl formatters that pair
// with the core router's URL-prefix locale routing (docs/I18N.md).
//
//   import { createI18n, t, fmt } from "@opentf/web-i18n";
//   createI18n({ locales: ["en", "fr"], defaultLocale: "en", messages: { … } });
//   t("greeting", { name });   // reactive on router.locale
//   fmt.currency(189, "USD");

export { createI18n, getLocale, loadLocale, locales, setCatalog, t } from "./i18n.js";
export { fmt } from "./format.js";

// `<T>` is a pure JSX component (compiled by the app's pipeline). The bare import
// retains its Custom Element registration side effect; the re-export exposes it.
import "./T.jsx";
export { default as T } from "./T.jsx";
