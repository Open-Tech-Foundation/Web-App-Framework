import { fmt } from "@opentf/web-i18n";
import { router, setLocale } from "@opentf/web";

// Formatters follow the active locale with no catalog needed — every value below is
// produced by `fmt.*` over the browser-native `Intl` APIs. Switch the locale and
// watch grouping, currency symbols, date order, and relative time all adapt.

const SAMPLE_DATE = new Date(Date.UTC(2026, 0, 9, 15, 30));

const frame = "not-prose mt-4 mb-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:p-5";
const tag = "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent";
const pillOn = "px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-600 text-white transition-all";
const pillOff = "px-2.5 py-1 rounded-full text-xs font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:border-indigo-500/50 transition-all";
const k = "text-[11px] font-mono text-[var(--text-muted)]";
const v = "text-sm font-bold text-[var(--text-main)]";
const cell = "rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 py-2";

export default function FormatMini() {
  const pill = (code, label) => (
    <button onclick={() => setLocale(code)} class={router.locale === code ? pillOn : pillOff}>{label}</button>
  );

  return (
    <div class={frame}>
      <div class="flex items-center justify-between gap-3 mb-4">
        <div class={tag}><span class="w-1.5 h-1.5 rounded-full bg-accent"></span>fmt.*</div>
        <div class="flex flex-wrap items-center justify-end gap-1.5">
          {pill("en-US", "en-US")}
          {pill("fr-FR", "fr-FR")}
          {pill("de-DE", "de-DE")}
          {pill("ja-JP", "ja-JP")}
          {pill("ar-EG", "ar-EG")}
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2.5">
        <div class={cell}><div class={k}>fmt.number</div><div class={v}>{fmt.number(1234567.89)}</div></div>
        <div class={cell}><div class={k}>fmt.currency · EUR</div><div class={v}>{fmt.currency(1299.5, "EUR")}</div></div>
        <div class={cell}><div class={k}>fmt.percent</div><div class={v}>{fmt.percent(0.426)}</div></div>
        <div class={cell}><div class={k}>fmt.date</div><div class={v}>{fmt.date(SAMPLE_DATE, { dateStyle: "long" })}</div></div>
        <div class={cell}><div class={k}>fmt.relativeTime</div><div class={v}>{fmt.relativeTime(-3, "hour")}</div></div>
        <div class={cell}><div class={k}>fmt.list</div><div class={v}>{fmt.list(["A", "B", "C"])}</div></div>
      </div>
    </div>
  );
}
