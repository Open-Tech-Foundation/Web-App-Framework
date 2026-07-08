// Hero scaffold command — chip tabs pick the package manager; copy writes the active one.

const MANAGERS = [
  { label: "npm", command: "npm create @opentf/web@latest my-app" },
  { label: "pnpm", command: "pnpm create @opentf/web my-app" },
  { label: "bun", command: "bun create @opentf/web my-app" },
];

export default function InstallTabs() {
  let active = $state(0);
  let copied = $state(false);

  const command = () => MANAGERS[active].command;

  const select = (index) => {
    active = index;
    copied = false;
  };

  const copy = () => {
    navigator.clipboard?.writeText(command());
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  };

  return (
    <div class="install-tabs">
      <div class="install-chips" role="tablist" aria-label="Package manager">
        {MANAGERS.map((pm, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={active === index}
            class={active === index ? "install-chip is-active" : "install-chip"}
            onclick={() => select(index)}
          >
            {pm.label}
          </button>
        ))}
      </div>

      <div class="install-pill mono" role="tabpanel">
        <span class="install-prompt">$</span>
        <span class="install-cmd">{command()}</span>
        <button class="install-copy" onclick={copy} aria-label="Copy install command">
          {() =>
            copied ? (
              <span class="install-copy-label is-copied">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Copied
              </span>
            ) : (
              <span class="install-copy-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy
              </span>
            )
          }
        </button>
      </div>
    </div>
  );
}