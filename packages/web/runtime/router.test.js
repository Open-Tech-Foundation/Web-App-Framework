import { describe, expect, test } from "bun:test";

import {
  configureI18n,
  localizePath,
  matchRoute,
  mountApp,
  navigate,
  resolveLocale,
  router,
  setLocale,
} from "./router.js";

// A page factory returning a labelled node. `__lifecycle` is exercised via mount.
function page(label) {
  return () => {
    const d = document.createElement("div");
    d.textContent = label;
    return d;
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("router", () => {
  test("registers routes, matches dynamic params, swaps on navigation", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);

    const pages = {
      "/proj/app/page.jsx": { default: page("home") },
      // lazy loader form (code-split route)
      "/proj/app/about/page.jsx": () =>
        Promise.resolve({ default: page("about") }),
      "/proj/app/post/[id]/page.jsx": { default: page("post") },
      "/proj/app/shop/[...slug]/page.jsx": { default: page("shop") },
      "/proj/app/404.jsx": { default: page("missing") },
    };

    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
    window.history.replaceState({}, "", "/");
    mountApp({ pages, target: app });
    await tick();

    expect(app.textContent).toContain("home");
    expect(router.pathname).toBe("/");

    await navigate("/about");
    expect(app.textContent).toContain("about");
    expect(router.pathname).toBe("/about");

    await navigate("/post/42");
    expect(app.textContent).toContain("post");
    expect(router.params.id).toBe("42");

    await navigate("/shop/clothing/shirts");
    expect(app.textContent).toContain("shop");
    expect(router.params.slug).toEqual(["clothing", "shirts"]);

    await navigate("/does-not-exist");
    expect(app.textContent).toContain("missing"); // 404 page

    await navigate("/about?q=1");
    expect(router.query.q).toBe("1");
  });

  test("composes layouts and passes params/children", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);

    // A page that reads its params, and a root layout that wraps children.
    const postPage = (props) => {
      const d = document.createElement("article");
      d.textContent = `post ${props.params.id}`;
      return d;
    };
    const rootLayout = (props) => {
      const shell = document.createElement("div");
      shell.className = "layout";
      const main = document.createElement("main");
      if (props.children) main.appendChild(props.children);
      shell.appendChild(main);
      return shell;
    };

    const pages = {
      "/proj2/app/layout.jsx": { default: rootLayout },
      "/proj2/app/post/[id]/page.jsx": { default: postPage },
    };

    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
    window.history.replaceState({}, "", "/post/7");
    mountApp({ pages, target: app });
    await tick();

    // Layout wraps the page; params reached the page.
    expect(app.querySelector(".layout main article")?.textContent).toBe("post 7");
  });
});

describe("i18n locale routing (prefix_except_default)", () => {
  test("resolveLocale strips non-default prefix; default stays bare", () => {
    configureI18n({ locales: ["en", "fr", "ja"], defaultLocale: "en" });

    // default locale: no prefix, path passes through
    expect(resolveLocale("/about")).toEqual({ locale: "en", path: "/about" });
    expect(resolveLocale("/")).toEqual({ locale: "en", path: "/" });

    // non-default locale: stripped, recorded
    expect(resolveLocale("/fr/about")).toEqual({ locale: "fr", path: "/about" });
    expect(resolveLocale("/ja")).toEqual({ locale: "ja", path: "/" });

    // a route whose first segment isn't a locale is left alone
    expect(resolveLocale("/enterprise")).toEqual({ locale: "en", path: "/enterprise" });

    configureI18n(null); // reset for other tests
  });

  test("localizePath prefixes non-default, keeps default bare, replaces existing", () => {
    configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });

    expect(localizePath("/about", "fr")).toBe("/fr/about");
    expect(localizePath("/about", "en")).toBe("/about"); // default bare
    expect(localizePath("/", "fr")).toBe("/fr");
    expect(localizePath("/fr/about", "en")).toBe("/about"); // existing prefix replaced
    expect(localizePath("/en/about", "fr")).toBe("/fr/about");

    configureI18n(null);
  });

  test("matchRoute resolves a prefixed URL to the locale-agnostic route", () => {
    configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });
    // matchRoute reads the live `routes` table; the previous suite registered "/about".
    const m = matchRoute("/fr/about");
    expect(m?.route).toBe("/about");
    configureI18n(null);
  });

  test("navigation updates router.locale and serves one route table for all locales", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);

    const pages = {
      "/i18n/app/page.jsx": { default: page("home") },
      "/i18n/app/about/page.jsx": { default: page("about") },
    };

    if (window.happyDOM?.setURL) window.happyDOM.setURL("http://localhost/");
    window.history.replaceState({}, "", "/");
    mountApp({ pages, target: app, i18n: { locales: ["en", "fr"], defaultLocale: "en" } });
    await tick();

    expect(router.locale).toBe("en");
    expect(app.textContent).toContain("home");

    await navigate("/fr/about");
    expect(router.locale).toBe("fr");
    expect(app.textContent).toContain("about"); // same route module, French URL
    expect(router.pathname).toBe("/fr/about");

    await navigate("/about");
    expect(router.locale).toBe("en");
    expect(app.textContent).toContain("about");

    configureI18n(null);
  });

  test("setLocale sets the active locale without navigating", () => {
    configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });
    setLocale("fr");
    expect(router.locale).toBe("fr");
    setLocale("en");
    expect(router.locale).toBe("en");
    configureI18n(null);
  });
});
