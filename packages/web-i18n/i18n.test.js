import { beforeEach, describe, expect, test } from "bun:test";

import { configureI18n, setRouteState } from "@opentf/web";

import { fmt } from "./format.js";
import { createI18n, getLocale, t } from "./i18n.js";

const messages = {
  en: {
    greeting: "Hello, {name}",
    "cart.items": "{count, plural, one {# item} other {# items}}",
    nested: { hi: "Hi" },
  },
  fr: {
    greeting: "Bonjour, {name}",
    "cart.items": "{count, plural, one {# article} other {# articles}}",
  },
  pl: {
    // Polish distinguishes one / few / many — exercises real ICU plural rules.
    files: "{count, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}",
  },
};

// Drive the active locale through the router state (what `t()`/`fmt` read).
const setLocale = (locale) => setRouteState({ locale });

describe("web-i18n t()", () => {
  beforeEach(() => {
    configureI18n({ locales: ["en", "fr", "pl"], defaultLocale: "en" });
    createI18n({ locales: ["en", "fr", "pl"], defaultLocale: "en", messages });
  });

  test("interpolates and tracks the active locale", () => {
    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(t("greeting", { name: "Ada" })).toBe("Hello, Ada");
    setLocale("fr");
    expect(t("greeting", { name: "Ada" })).toBe("Bonjour, Ada");
  });

  test("ICU plurals — English", () => {
    setLocale("en");
    expect(t("cart.items", { count: 1 })).toBe("1 item");
    expect(t("cart.items", { count: 5 })).toBe("5 items");
  });

  test("ICU plurals — Polish (3-form)", () => {
    setLocale("pl");
    expect(t("files", { count: 1 })).toBe("1 plik");
    expect(t("files", { count: 3 })).toBe("3 pliki");
    expect(t("files", { count: 7 })).toBe("7 plików");
  });

  test("dotted-nested key, fallback to default locale, missing → key", () => {
    setLocale("en");
    expect(t("nested.hi")).toBe("Hi");
    setLocale("fr"); // fr has no nested.hi → falls back to en
    expect(t("nested.hi")).toBe("Hi");
    expect(t("totally.missing")).toBe("totally.missing");
  });
});

describe("web-i18n fmt", () => {
  beforeEach(() => {
    configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });
    createI18n({ locales: ["en", "fr"], defaultLocale: "en", messages });
  });

  test("number + currency per active locale", () => {
    setLocale("en");
    expect(fmt.number(1234.5)).toBe("1,234.5");
    expect(fmt.currency(189, "USD")).toBe("$189.00");
  });

  test("plural category + relativeTime", () => {
    setLocale("en");
    expect(fmt.plural(1)).toBe("one");
    expect(fmt.plural(2)).toBe("other");
    expect(fmt.relativeTime(-3, "day")).toBe("3 days ago");
  });
});
