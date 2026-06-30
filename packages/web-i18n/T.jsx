// <T id values /> — inline translation component (docs/I18N.md §5).
//
// Sugar over `t(id, values)`: renders the translated string into a <span>, wired
// reactively to the active locale like any text binding. For messages that
// interpolate a *signal* (e.g. a live `{count}`), prefer the bare `{t("key", { count })}`
// form in markup so the compiler tracks the signal directly.
//
// Shipped as JSX source and compiled by the consuming app's pipeline (like <Link>).

import { t } from "./i18n.js";

export default function T({ id, values }) {
  return <span>{t(id, values)}</span>;
}
