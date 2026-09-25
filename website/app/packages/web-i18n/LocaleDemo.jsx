import { fmt, t, createI18n } from "@opentf/web-i18n";
import { router, setLocale } from "@opentf/web";

// Hero demo for @opentf/web-i18n: a localized order receipt. Tap a language and the
// whole card re-renders fine-grained — ICU plurals, currency, dates, relative time,
// and list formatting all follow the active locale (Arabic flips the card to RTL).
//
// In a real app the locale comes from the URL (`/fr/…`) and switching is a
// navigation; here we drive it with `setLocale` so the demo lives on one page.

createI18n({
  locales: ["en", "fr", "ja", "ar"],
  defaultLocale: "en",
  messages: {
    en: {
      greeting: "Welcome back, {name}",
      "cart.items": "{count, plural, =0 {Your cart is empty} one {# item} other {# items}}",
      total: "Order total",
      placed: "Ordered {when}",
      ships: "Ships in {days, plural, one {# day} other {# days}}",
      "item.coffee": "Coffee beans",
      "item.mug": "Ceramic mug",
      "item.book": "Brewing guide",
    },
    fr: {
      greeting: "Bon retour, {name}",
      "cart.items": "{count, plural, =0 {Votre panier est vide} one {# article} other {# articles}}",
      total: "Total de la commande",
      placed: "Commandé {when}",
      ships: "Expédié dans {days, plural, one {# jour} other {# jours}}",
      "item.coffee": "Grains de café",
      "item.mug": "Tasse en céramique",
      "item.book": "Guide de préparation",
    },
    ja: {
      greeting: "おかえりなさい、{name}さん",
      "cart.items": "{count, plural, =0 {カートは空です} other {商品#点}}",
      total: "ご注文合計",
      placed: "注文日: {when}",
      ships: "{days}日で発送",
      "item.coffee": "コーヒー豆",
      "item.mug": "陶器のマグカップ",
      "item.book": "淹れ方ガイド",
    },
    ar: {
      greeting: "مرحبًا بعودتك، {name}",
      "cart.items":
        "{count, plural, zero {سلتك فارغة} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}",
      total: "إجمالي الطلب",
      placed: "تم الطلب {when}",
      ships: "يُشحن خلال {days} يوم",
      "item.coffee": "حبوب البن",
      "item.mug": "كوب سيراميك",
      "item.book": "دليل التحضير",
    },
  },
});

// Currency + amount per locale (shows real currency formatting differences).
const MONEY = { en: ["USD", 42], fr: ["EUR", 39], ja: ["JPY", 6200], ar: ["SAR", 158] };
const ORDER_DATE = new Date(Date.UTC(2026, 5, 28));

const wrap = "not-prose mt-6 mb-12 rounded-3xl border border-[var(--border)] bg-[var(--bg-main)] p-5 sm:p-6 text-[var(--text-main)]";
const tag = "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent";
const pillOn = "px-3 py-1.5 rounded-full text-sm font-bold bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all";
const pillOff = "px-3 py-1.5 rounded-full text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:border-indigo-500/50 transition-all";
const row = "flex items-center justify-between gap-4 py-2.5 border-b border-[var(--border)] last:border-0";
const rk = "text-sm text-[var(--text-muted)]";
const rv = "text-sm font-bold text-[var(--text-main)] text-right";
const step = "w-8 h-8 grid place-items-center rounded-lg border border-[var(--border)] text-lg font-bold text-[var(--text-main)] hover:border-indigo-500/60 disabled:opacity-40 transition-all";

export default function LocaleDemo() {
  // This demo owns the (global) locale; start it in English. In a real app the
  // locale comes from the URL, so you wouldn't set it imperatively.
  setLocale("en");
  let count = $state(2);

  // Active-locale reads (each re-runs when router.locale changes).
  const money = () => {
    const [cur, amt] = MONEY[router.locale] ?? MONEY.en;
    return fmt.currency(amt, cur);
  };
  const items = () => fmt.list([t("item.coffee"), t("item.mug"), t("item.book")]);
  const placedWhen = () => fmt.relativeTime(-2, "day");

  return (
    <div class={wrap}>
      <div class="flex items-center justify-between gap-3 mb-5 pb-4 border-b border-[var(--border)]">
        <div class={tag}>
          <span class="w-1.5 h-1.5 rounded-full bg-accent"></span>Live demo
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <button onclick={() => setLocale("en")} class={router.locale === "en" ? pillOn : pillOff}>English</button>
          <button onclick={() => setLocale("fr")} class={router.locale === "fr" ? pillOn : pillOff}>Français</button>
          <button onclick={() => setLocale("ja")} class={router.locale === "ja" ? pillOn : pillOff}>日本語</button>
          <button onclick={() => setLocale("ar")} class={router.locale === "ar" ? pillOn : pillOff}>العربية</button>
        </div>
      </div>

      <div dir={router.locale === "ar" ? "rtl" : "ltr"}>
        <p class="text-lg font-black mb-1">{t("greeting", { name: "Ada" })}</p>
        <p class="text-sm text-[var(--text-muted)] mb-5">{items()}</p>

        <div class="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:p-5">
          <div class={row}>
            <span class={rk}>{t("cart.items", { count: count })}</span>
            <span class="flex items-center gap-2">
              <button class={step} onclick={() => (count = Math.max(0, count - 1))} aria-label="decrease">−</button>
              <span class="w-6 text-center font-black tabular-nums">{count}</span>
              <button class={step} onclick={() => (count = count + 1)} aria-label="increase">+</button>
            </span>
          </div>
          <div class={row}>
            <span class={rk}>{t("total")}</span>
            <span class={rv}>{money()}</span>
          </div>
          <div class={row}>
            <span class={rk}>{t("placed", { when: placedWhen() })}</span>
            <span class={rv}>{fmt.date(ORDER_DATE, { dateStyle: "medium" })}</span>
          </div>
          <div class={row}>
            <span class={rk}>{t("ships", { days: 3 })}</span>
            <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
              {router.locale}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
