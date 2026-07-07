// Live demo for the Context guide: theme flows down the tree via ContextProvider,
// nested providers override, and a reactive $state value updates every consumer.

import { ContextProvider, createContext } from "@opentf/web";

const ThemeContext = createContext("dark");

function ThemedCard(props) {
  const theme = $context(ThemeContext);
  return (
    <div className="demo-context-card" data-theme={theme}>
      <div className="demo-context-card-label">{props.title}</div>
      <div className="demo-context-card-value">
        theme = <span className="demo-context-mono">{theme}</span>
      </div>
    </div>
  );
}

export default function ContextDemo() {
  let theme = $state("dark");
  const cycle = () => {
    theme =
      theme === "dark" ? "light" : theme === "light" ? "high-contrast" : "dark";
  };

  return (
    <div className="demo-output demo-output--context">
      <span className="demo-output-label">Output</span>
      <div className="demo-context">
        <button type="button" className="demo-context-cycle" onclick={cycle}>
          Cycle page theme (now: {theme})
        </button>
        <ContextProvider context={ThemeContext} value={theme}>
          <div className="demo-context-grid">
            <ThemedCard title="Inherits page theme" />
            <ContextProvider context={ThemeContext} value="high-contrast">
              <ThemedCard title="Nested override" />
            </ContextProvider>
          </div>
        </ContextProvider>
      </div>
    </div>
  );
}