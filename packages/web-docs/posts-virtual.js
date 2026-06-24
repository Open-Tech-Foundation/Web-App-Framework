// Fallback for `@opentf/web-docs/posts`.
//
// When `blogPostsPlugin` is active (the toolchain registers it whenever the project
// has a `blog` config), it intercepts this specifier and replaces it with a
// build-time-generated module exporting the post list. This file is only loaded when
// the plugin is NOT active (e.g. an editor, or a project without a blog), in which
// case the list is simply empty.

if (typeof console !== "undefined") {
  console.warn(
    "[@opentf/web-docs] posts requested but blogPostsPlugin is not active — " +
      "did you add a `blog` block to otfw.config.js? Returning an empty list.",
  );
}

export const posts = [];
export default posts;
