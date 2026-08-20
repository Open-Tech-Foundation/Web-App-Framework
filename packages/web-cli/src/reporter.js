// Build reporter. Each phase is a "step" that announces itself, then collapses to a
// green ✅ line with the elapsed time when done.
//
// On a terminal the announcement is a spinner that stays on one line and shows what
// the phase is working on. Anywhere else — CI, a piped log, a file — there is nothing
// to animate and no width to fit into, so the step prints one line when it starts and
// one when it ends, which is what a log wants to hold anyway.

import { stdout } from "runtime:process";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_IN = "•";
const INTERVAL = 80;

const animated = () => Boolean(stdout?.isTTY);
const width = () => stdout?.columns ?? 80;

/** Humanize a millisecond duration: 940ms, 5.2s. */
export function fmtMs(n) {
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}

/** Cut `s` to the terminal width, so a long path cannot wrap and orphan a line. */
function fit(s) {
  const max = width() - 1;
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

// The step currently drawing, if any. A spinner owns the last line of the terminal,
// so anything else that prints has to take the line back first — see `quiet`.
let live = null;

/**
 * Stop whatever is spinning and clear its line, so a diagnostic printed from deep
 * inside a build starts on a clean one. `console` is read-only here, so this is a
 * call the printer makes rather than something the reporter can arrange for it.
 */
export function quiet() {
  live?.stop();
}

class Step {
  constructor(label) {
    this.label = label;
    this.detail = "";
    this.t0 = performance.now();
    this.frame = 0;
    this.timer = null;

    if (!animated()) return void console.log(`  ${FRAME_IN} ${label}…`);
    live = this;
    this.draw();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.draw();
    }, INTERVAL);
  }

  draw() {
    const detail = this.detail ? `  ${this.detail}` : "";
    stdout.write(`\r[2K${fit(`  ${FRAMES[this.frame]} ${this.label}…${detail}`)}`);
  }

  /**
   * Record the live detail (the current file, an `N/total` count). On a terminal it
   * rides along on the spinner's line; elsewhere nothing is printed — that would be
   * one line per compiled module — but the last value is kept so a failure can say
   * how far the phase got.
   */
  update(detail) {
    this.detail = detail || "";
    if (this.timer) this.draw();
  }

  /** Finish the step: green ✅ with `msg` (defaults to the label) and elapsed time. */
  done(msg) {
    this.stop();
    console.log(`  ✅ ${msg || this.label}  ${fmtMs(performance.now() - this.t0)}`);
  }

  /** Mark the step failed: red ✗ with `msg`, plus how far it had got. */
  fail(msg) {
    const where = this.detail ? `  (at ${this.detail})` : "";
    this.stop();
    console.log(`  ✗ ${msg || this.label}${where}`);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    stdout.write("\r[2K");
    live = null;
  }
}

/** Start a build phase. Returns a `Step` you drive with `.update()` then `.done()`. */
export function step(label) {
  return new Step(label);
}
