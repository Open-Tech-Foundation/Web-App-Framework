import { describe, expect, test } from "bun:test";

import { mountApp, navigate, router } from "./router.js";

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
