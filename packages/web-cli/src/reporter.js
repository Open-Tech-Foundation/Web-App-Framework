// Build reporter. Each phase is a "step" that announces itself, then collapses to a
// green ✅ line with the elapsed time when done.
//
// There is no in-place spinner: the runtime exposes no raw stdout handle and no TTY
// flag, only `console`, so an animated line has nothing to rewrite itself with. This
// is the same output the previous reporter produced on a non-interactive stream (CI,
// piped logs) — one line in, one line out per phase — now used everywhere.

const FRAME_IN = "•";

/** Humanize a millisecond duration: 940ms, 5.2s. */
export function fmtMs(n) {
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}

class Step {
  constructor(label) {
    this.label = label;
    this.detail = "";
    this.t0 = performance.now();
    console.log(`  ${FRAME_IN} ${label}…`);
  }

  /**
   * Record the live detail (the current file, an `N/total` count). Nothing is printed
   * per update — that would be one line per compiled module — but the last value is
   * kept so a failure can say how far the phase got.
   */
  update(detail) {
    this.detail = detail || "";
  }

  /** Finish the step: green ✅ with `msg` (defaults to the label) and elapsed time. */
  done(msg) {
    console.log(`  ✅ ${msg || this.label}  ${fmtMs(performance.now() - this.t0)}`);
  }

  /** Mark the step failed: red ✗ with `msg`, plus how far it had got. */
  fail(msg) {
    const where = this.detail ? `  (at ${this.detail})` : "";
    console.log(`  ✗ ${msg || this.label}${where}`);
  }
}

/** Start a build phase. Returns a `Step` you drive with `.update()` then `.done()`. */
export function step(label) {
  return new Step(label);
}
