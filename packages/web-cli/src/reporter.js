// Pretty, TTY-aware build reporter. Each phase is a "step" that shows an animated
// spinner with live detail while it runs, then collapses to a green ✅ line with the
// elapsed time when done. On a non-interactive stream (CI, piped logs) the spinner and
// in-place updates are skipped — only the final ✅/✗ line per step is printed — so logs
// stay clean and free of carriage returns.

const TTY = !!process.stdout.isTTY;
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const paint = (code, s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => paint(2, s);
const cyan = (s) => paint(36, s);
const red = (s) => paint(31, s);

/** Humanize a millisecond duration: 940ms, 5.2s. */
export function fmtMs(n) {
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}

class Step {
  constructor(label) {
    this.label = label;
    this.detail = "";
    this.t0 = performance.now();
    this.frame = 0;
    this.timer = null;
    if (TTY) {
      this.render();
      this.timer = setInterval(() => this.render(), 80);
    } else {
      process.stdout.write(`  ${dim("•")} ${label}…\n`);
    }
  }

  render() {
    const spinner = cyan(FRAMES[(this.frame = (this.frame + 1) % FRAMES.length)]);
    const detail = this.detail ? "  " + dim(this.detail) : "";
    process.stdout.write(`\r\x1b[K  ${spinner} ${this.label}${detail}`);
  }

  /**
   * Update the live detail (e.g. the current file or an `N/total` count) and repaint
   * immediately. The immediate repaint matters because compilation runs synchronous
   * subprocesses that block the event loop — the `setInterval` tick can't fire during
   * them, so each `update()` is what actually advances the line.
   */
  update(detail) {
    this.detail = detail || "";
    if (TTY) this.render();
  }

  _stop() {
    if (this.timer) clearInterval(this.timer);
    if (TTY) process.stdout.write("\r\x1b[K");
  }

  /** Finish the step: green ✅ with `msg` (defaults to the label) and elapsed time. */
  done(msg) {
    this._stop();
    process.stdout.write(`  ✅ ${msg || this.label}  ${dim(fmtMs(performance.now() - this.t0))}\n`);
  }

  /** Mark the step failed: red ✗ with `msg`. */
  fail(msg) {
    this._stop();
    process.stdout.write(`  ${red("✗")} ${msg || this.label}\n`);
  }
}

/** Start a build phase. Returns a `Step` you drive with `.update()` then `.done()`. */
export function step(label) {
  return new Step(label);
}
