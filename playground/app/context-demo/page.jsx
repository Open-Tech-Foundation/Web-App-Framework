// Context API demo: a theme provided down the tree, with a nested override.
// `ThemedCard` never receives the theme as a prop — it reads it from context via
// the nearest <ContextProvider> (resolved through the DOM, since components are
// Custom Elements). The page's $state flows through the provider as a signal, so
// cycling the theme updates every consumer fine-grained.

import { ContextProvider, createContext } from "@opentf/web";

const ThemeContext = createContext("dark");

function ThemedCard(props) {
  const theme = $context(ThemeContext);
  return (
    <div
      class={
        "rounded-xl border p-5 transition-colors " +
        (theme === "light"
          ? "bg-white text-slate-900 border-slate-300"
          : theme === "high-contrast"
            ? "bg-black text-yellow-300 border-yellow-400"
            : "bg-slate-800 text-slate-100 border-slate-600")
      }
    >
      <div class="text-xs uppercase tracking-wide opacity-60">{props.title}</div>
      <div class="mt-1 text-lg font-semibold">
        theme = <span class="font-mono">{theme}</span>
      </div>
    </div>
  );
}

export default function ContextDemoPage() {
  let theme = $state("dark");
  const cycle = () => {
    theme = theme === "dark" ? "light" : theme === "light" ? "high-contrast" : "dark";
  };

  return (
    <div class="space-y-6">
      <header class="space-y-2">
        <h1 class="text-3xl font-bold text-white">Context API</h1>
        <p class="text-slate-400 max-w-2xl">
          <code>$context</code> reads the value from the nearest{" "}
          <code>&lt;ContextProvider&gt;</code> above it in the tree — no prop
          drilling. The outer card inherits the page theme; the inner card sits
          under a nested provider that overrides it.
        </p>
      </header>

      <button
        onclick={cycle}
        class="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-600"
      >
        Cycle page theme (now: {theme})
      </button>

      <ContextProvider context={ThemeContext} value={theme}>
        <div class="grid gap-4 md:grid-cols-2">
          <ThemedCard title="Inherits page theme" />
          <ContextProvider context={ThemeContext} value="high-contrast">
            <ThemedCard title="Nested override → high-contrast" />
          </ContextProvider>
        </div>
      </ContextProvider>
    </div>
  );
}
