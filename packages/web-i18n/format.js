//! Locale-aware formatters over the browser-native `Intl` APIs (docs/I18N.md §5).
//
// Each formatter reads the active locale from `getLocale()` (which tracks the
// reactive `router.locale`), so `fmt.currency(...)` inside a binding re-renders on
// a locale-changing navigation. `Intl.*` instances are memoized per
// (kind, locale, options) — constructing them is comparatively expensive.

import { getLocale } from "./i18n.js";

const cache = new Map();

function intl(kind, Ctor, options) {
  const locale = getLocale();
  const key = `${kind} ${locale} ${options ? JSON.stringify(options) : ""}`;
  let inst = cache.get(key);
  if (!inst) {
    inst = new Ctor(locale, options);
    cache.set(key, inst);
  }
  return inst;
}

export const fmt = {
  /** Locale-grouped number: `fmt.number(1234.5)`. */
  number: (value, options) => intl("n", Intl.NumberFormat, options).format(value),

  /** Currency: `fmt.currency(189, "USD")` → "$189.00" / "189,00 $US". */
  currency: (value, currency, options) =>
    intl("c", Intl.NumberFormat, { style: "currency", currency, ...options }).format(value),

  /** Percent: `fmt.percent(0.42)` → "42%". */
  percent: (value, options) =>
    intl("pc", Intl.NumberFormat, { style: "percent", ...options }).format(value),

  /** Date/time: `fmt.date(new Date(), { dateStyle: "long" })`. */
  date: (value, options) => intl("d", Intl.DateTimeFormat, options).format(value),

  /** Relative time: `fmt.relativeTime(-3, "day")` → "3 days ago". */
  relativeTime: (value, unit, options) =>
    intl("r", Intl.RelativeTimeFormat, options).format(value, unit),

  /** Plural category for the active locale: `fmt.plural(2)` → "other". */
  plural: (value, options) => intl("p", Intl.PluralRules, options).select(value),

  /** List: `fmt.list(["a","b","c"])` → "a, b, and c". */
  list: (values, options) => intl("l", Intl.ListFormat, options).format(values),
};
