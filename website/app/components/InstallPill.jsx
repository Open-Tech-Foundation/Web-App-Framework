// The hero install command with a one-click copy button. Clicking writes the command
// to the clipboard and flips the button to a green "Copied" state for ~2s.

export default function InstallPill(props) {
  const command = props.command || "";
  let copied = $state(false);

  const copy = () => {
    navigator.clipboard?.writeText(command);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  };

  return (
    <div class="install-pill mono">
      <span class="install-prompt">$</span>
      <span class="install-cmd">{command}</span>
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
  );
}
