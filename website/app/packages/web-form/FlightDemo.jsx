import { createForm } from "@opentf/web-form";

// The Flight Booking wizard, embedded in the docs as the hero demo. One shared
// form across every step; mostly tap-to-pick UI; a live Dev Panel mirrors the
// form's reactive state. Surfaces use the docs theme variables, so it follows
// the site's light/dark mode; the Dev Panel stays terminal-dark on purpose.

const AIRPORTS = [
  { code: "BLR", city: "Bengaluru" },
  { code: "DXB", city: "Dubai" },
  { code: "SIN", city: "Singapore" },
  { code: "LHR", city: "London" },
  { code: "JFK", city: "New York" },
];
const FLIGHTS = [
  { id: "6E1407", airline: "IndiGo", dep: "08:15", arr: "11:40", dur: "3h 25m", stops: "Non-stop", price: 218 },
  { id: "EK565", airline: "Emirates", dep: "13:50", arr: "17:05", dur: "3h 15m", stops: "Non-stop", price: 295 },
  { id: "AI934", airline: "Air India", dep: "21:30", arr: "01:20", dur: "3h 50m", stops: "1 stop", price: 189 },
];
const CARDS = [
  { id: "visa", brand: "Visa", last4: "4242", exp: "08/27" },
  { id: "mc", brand: "Mastercard", last4: "5588", exp: "02/26" },
];
const EXTRAS = [
  { key: "baggage", label: "Extra baggage", price: 18 },
  { key: "meal", label: "Hot meal", price: 9 },
  { key: "insurance", label: "Travel insurance", price: 13 },
];
const STEPS = ["Search", "Flight", "Travelers", "Payment", "Review"];

const card = "rounded-2xl border p-4 cursor-pointer transition-all text-left";
const cardOn = card + " border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40";
const cardOff = card + " border-[var(--border)] bg-[var(--bg-surface)] hover:border-indigo-400/60";
// Toggle chips read as a *segmented / tonal* control (soft indigo fill, indigo
// outline) so they stay visually distinct from the solid filled primary CTA.
const chip = "px-4 py-2 rounded-xl text-sm font-bold border transition-all";
const chipOn = chip + " bg-indigo-500/15 text-indigo-500 border-indigo-500 ring-1 ring-indigo-500/30";
const chipOff = chip + " text-[var(--text-muted)] border-[var(--border)] hover:border-indigo-400/60";
// Button variants: solid = primary action, ghost = secondary, soft = tertiary.
const btnPrimary = "px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-500 shadow-lg shadow-indigo-600/25 transition-all";
const btnConfirm = "px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-500 shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50 disabled:shadow-none";
const btnGhost = "px-5 py-2.5 rounded-xl border border-[var(--border)] text-[var(--text-main)] font-bold text-sm hover:border-indigo-400 hover:text-indigo-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-main)]";
const field = "w-full px-3 py-2.5 rounded-xl border bg-[var(--bg-main)] text-[var(--text-main)] text-sm outline-none border-[var(--border)] focus:border-indigo-500/60 transition-all";
const usd = (n) => "$" + n.toLocaleString("en-US");

export default function FlightDemo() {
  let step = $state(0);
  let devTab = $state("values");
  let promoState = $state("");
  let triedNext = $state(false);

  const form = createForm({
    mode: "onBlur",
    initialValues: {
      tripType: "round",
      from: "BLR",
      to: "DXB",
      depart: "",
      ret: "",
      passengers: 1,
      cabin: "economy",
      flightId: "",
      travelers: [{ firstName: "", lastName: "" }],
      extras: { baggage: false, meal: false, insurance: false },
      cardId: "",
      promo: "",
      agree: false,
    },
    validate: (v) => {
      const e = {};
      const t = v.travelers.map((p) => {
        const o = {};
        if (!p.firstName.trim()) o.firstName = "*Required";
        if (!p.lastName.trim()) o.lastName = "*Required";
        return o;
      });
      if (t.some((o) => o.firstName || o.lastName)) e.travelers = t;
      return e;
    },
  });

  const setPax = (n) => {
    n = Math.max(1, Math.min(4, n));
    form.values.passengers = n;
    const t = form.values.travelers;
    while (t.length < n) t.push({ firstName: "", lastName: "" });
    while (t.length > n) t.pop();
  };

  const flight = () => FLIGHTS.find((f) => f.id === form.values.flightId);
  const discount = () => (promoState === "ok" ? 0.1 : 0);
  const fare = () => {
    const f = flight();
    if (!f) return 0;
    const cabinUp = form.values.cabin === "business" ? 140 : 0;
    let total = (f.price + cabinUp) * form.values.passengers;
    for (const x of EXTRAS) if (form.values.extras[x.key]) total += x.price * form.values.passengers;
    return Math.round(total * (1 - discount()));
  };

  const applyPromo = () => {
    promoState = "checking";
    setTimeout(() => (promoState = form.values.promo === "FLY10" ? "ok" : "bad"), 700);
  };

  const stepOk = (s) => {
    const v = form.values;
    if (s === 0) return v.from && v.to && v.from !== v.to && v.depart && (v.tripType !== "round" || v.ret);
    if (s === 1) return !!v.flightId;
    if (s === 2) {
      const n = v.travelers.length;
      for (let i = 0; i < n; i++) if (!v.travelers[i].firstName || !v.travelers[i].lastName) return false;
      return true;
    }
    if (s === 3) return v.cardId && v.agree;
    return true;
  };

  const next = () => {
    if (!stepOk(step)) {
      triedNext = true; // reveal the missing-field messages instead of blocking
      return;
    }
    triedNext = false;
    step = Math.min(STEPS.length - 1, step + 1);
  };
  const back = () => {
    triedNext = false;
    step = Math.max(0, step - 1);
  };

  const onSubmit = async (values) => {
    await new Promise((r) => setTimeout(r, 1400));
    console.log("Booking confirmed:", values);
  };

  // Start over: clears the form (and isSubmitted) and returns to step one.
  const resetBooking = () => {
    form.reset();
    step = 0;
    promoState = "";
    triedNext = false;
  };

  return (
    <div class="not-prose mt-6 mb-12 rounded-3xl border border-[var(--border)] bg-[var(--bg-main)] p-5 sm:p-6 text-[var(--text-main)]">
      <div class="flex items-center justify-center gap-3 mb-6 pb-5 border-b border-[var(--border)]">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/25 to-sky-500/10 border border-indigo-500/30 grid place-items-center text-indigo-500 shrink-0">
          <svg class="w-6 h-6 block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
          </svg>
        </div>
        {/* A <div>, not an <h3>: the docs prose theme injects heading margins
            that would offset this title from the icon's vertical center. */}
        <div class="text-[var(--text-main)] font-black text-xl leading-none flex items-center gap-2">
          Flight Booking Form
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-accent/15 text-accent font-bold uppercase tracking-widest leading-none">Demo</span>
        </div>
      </div>

      <div class="flex items-center gap-2 mb-6 overflow-x-auto">
        {STEPS.map((label, i) => (
          <div class="flex items-center gap-2 shrink-0">
            <span class={i < step ? "w-7 h-7 rounded-full grid place-items-center text-xs font-black bg-indigo-600 text-white" : i === step ? "w-7 h-7 rounded-full grid place-items-center text-xs font-black border-2 border-indigo-500 text-indigo-600" : "w-7 h-7 rounded-full grid place-items-center text-xs font-black border border-[var(--border)] text-[var(--text-muted)]"}>
              {i < step ? "✓" : i + 1}
            </span>
            <span class={i <= step ? "text-xs font-bold uppercase tracking-wider text-indigo-600 hidden sm:inline" : "text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] hidden sm:inline"}>{label}</span>
            {i < STEPS.length - 1 && (
              <span class="relative w-6 sm:w-8 h-0.5 rounded-full bg-[var(--border)] overflow-hidden shrink-0">
                <span class={"absolute inset-y-0 left-0 rounded-full bg-indigo-500 transition-[width] duration-500 ease-out " + (i < step ? "w-full" : "w-0")}></span>
              </span>
            )}
          </div>
        ))}
      </div>

      <div class="grid xl:grid-cols-[1fr_300px] gap-6 items-start">
        <section class="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 min-h-[380px]">
          {step === 0 && (
            <div class="space-y-5">
              <div class="flex gap-2">
                <button type="button" onclick={() => (form.values.tripType = "oneway")} class={form.values.tripType === "oneway" ? chipOn : chipOff}>One way</button>
                <button type="button" onclick={() => (form.values.tripType = "round")} class={form.values.tripType === "round" ? chipOn : chipOff}>Round trip</button>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">From</label>
                  <select {...form.register("from")} class={field}>{AIRPORTS.map((a) => <option value={a.code}>{a.code} · {a.city}</option>)}</select>
                </div>
                <div>
                  <label class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">To</label>
                  <select {...form.register("to")} class={field}>{AIRPORTS.map((a) => <option value={a.code}>{a.code} · {a.city}</option>)}</select>
                </div>
              </div>
              {form.values.from === form.values.to && <p class="text-[11px] text-red-500 font-bold">Origin and destination can't match.</p>}
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Departure</label>
                  <input type="date" {...form.register("depart")} class={field} />
                  {triedNext && !form.values.depart && <span class="text-[10px] text-red-500 font-bold">*Required</span>}
                </div>
                {form.values.tripType === "round" && (
                  <div>
                    <label class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Return</label>
                    <input type="date" {...form.register("ret")} class={field} />
                    {triedNext && !form.values.ret && <span class="text-[10px] text-red-500 font-bold">*Required</span>}
                  </div>
                )}
              </div>
              <div class="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <label class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1">Passengers</label>
                  <div class="flex items-center gap-3">
                    <button type="button" onclick={() => setPax(form.values.passengers - 1)} class="w-9 h-9 rounded-xl border border-[var(--border)] text-[var(--text-main)] text-lg">−</button>
                    <span class="w-8 text-center text-[var(--text-main)] font-bold text-lg">{form.values.passengers}</span>
                    <button type="button" onclick={() => setPax(form.values.passengers + 1)} class="w-9 h-9 rounded-xl border border-[var(--border)] text-[var(--text-main)] text-lg">+</button>
                  </div>
                </div>
                <div>
                  <label class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1">Cabin</label>
                  <div class="flex gap-2">
                    <button type="button" onclick={() => (form.values.cabin = "economy")} class={form.values.cabin === "economy" ? chipOn : chipOff}>Economy</button>
                    <button type="button" onclick={() => (form.values.cabin = "business")} class={form.values.cabin === "business" ? chipOn : chipOff}>Business</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div class="space-y-3">
              {triedNext && !form.values.flightId && <p class="text-xs text-red-500 font-bold flex items-center gap-1.5"><span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>Please select a flight to continue.</p>}
              {FLIGHTS.map((f) => (
                <button type="button" onclick={() => (form.values.flightId = f.id)} class={form.values.flightId === f.id ? cardOn + " w-full" : cardOff + " w-full"}>
                  <div class="flex items-center justify-between">
                    <div>
                      <div class="text-[var(--text-main)] font-bold">{f.airline} <span class="text-[var(--text-muted)] text-xs font-medium">{f.id}</span></div>
                      <div class="text-[var(--text-muted)] text-sm mt-1">{f.dep} → {f.arr} · {f.dur} · {f.stops}</div>
                    </div>
                    <div class="text-right">
                      <div class="text-[var(--text-main)] font-black text-lg">{usd(form.values.cabin === "business" ? f.price + 140 : f.price)}</div>
                      <div class="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">per traveler</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div class="space-y-5">
              {form.values.travelers.map((_, i) => (
                <div class="rounded-2xl border border-[var(--border)] p-4">
                  <div class="text-[11px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-3">Traveler {i + 1}</div>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <input {...form.register(`travelers.${i}.firstName`)} placeholder="First name" class={field} />
                      {((triedNext && !form.values.travelers[i].firstName) || form.errors.travelers?.[i]?.firstName) && <span class="text-[10px] text-red-500 font-bold">*Required</span>}
                    </div>
                    <div>
                      <input {...form.register(`travelers.${i}.lastName`)} placeholder="Last name" class={field} />
                      {((triedNext && !form.values.travelers[i].lastName) || form.errors.travelers?.[i]?.lastName) && <span class="text-[10px] text-red-500 font-bold">*Required</span>}
                    </div>
                  </div>
                </div>
              ))}
              <div>
                <div class="text-[11px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-2">Add-ons</div>
                <div class="flex flex-wrap gap-2">
                  {EXTRAS.map((x) => (
                    <button type="button" onclick={() => (form.values.extras[x.key] = !form.values.extras[x.key])} class={form.values.extras[x.key] ? chipOn : chipOff}>{x.label} · {usd(x.price)}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div class="space-y-5">
              <div class="text-[11px] font-black text-[var(--text-muted)] uppercase tracking-widest">Saved cards</div>
              <div class="grid sm:grid-cols-2 gap-3">
                {CARDS.map((c) => (
                  <button type="button" onclick={() => (form.values.cardId = c.id)} class={form.values.cardId === c.id ? cardOn : cardOff}>
                    <div class="flex items-center justify-between">
                      <span class="text-[var(--text-main)] font-bold">{c.brand}</span>
                      <span class="text-[10px] text-[var(--text-muted)] uppercase">{c.exp}</span>
                    </div>
                    <div class="text-[var(--text-muted)] font-mono mt-3 tracking-widest">•••• {c.last4}</div>
                  </button>
                ))}
              </div>
              {triedNext && !form.values.cardId && <p class="text-xs text-red-500 font-bold flex items-center gap-1.5"><span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>Please choose a card to pay with.</p>}
              <div>
                <div class="text-[11px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-2">Promo code</div>
                <div class="flex gap-2">
                  <input {...form.register("promo")} placeholder="Try FLY10" class={field + " flex-1"} />
                  <button type="button" onclick={applyPromo} class="px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-main)] text-sm font-bold hover:border-indigo-400">{promoState === "checking" ? "…" : "Apply"}</button>
                </div>
                {promoState === "ok" && <p class="text-[11px] text-emerald-600 font-bold mt-1">FLY10 applied — 10% off.</p>}
                {promoState === "bad" && <p class="text-[11px] text-red-500 font-bold mt-1">Invalid promo code.</p>}
              </div>
              <div>
                <label class="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" {...form.register("agree")} />
                  <span class="text-sm text-[var(--text-muted)]">I agree to the fare rules and terms.</span>
                </label>
                {triedNext && !form.values.agree && <p class="mt-1 text-xs text-red-500 font-bold flex items-center gap-1.5"><span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>Please accept the terms to continue.</p>}
              </div>
            </div>
          )}

          {step === 4 && (
            <div class="space-y-4">
              <Row k="Route" v={`${form.values.from} → ${form.values.to} · ${form.values.tripType === "round" ? "Round trip" : "One way"}`} />
              <Row k="Dates" v={form.values.tripType === "round" ? `${form.values.depart} – ${form.values.ret}` : form.values.depart} />
              <Row k="Flight" v={flight() ? `${flight().airline} ${flight().id} · ${flight().dep}→${flight().arr}` : "—"} />
              <Row k="Cabin" v={`${form.values.cabin} · ${form.values.passengers} traveler(s)`} />
              <Row k="Travelers" v={form.values.travelers.map((t) => `${t.firstName} ${t.lastName}`).join(", ")} />
              <Row k="Payment" v={`•••• ${(CARDS.find((c) => c.id === form.values.cardId) || {}).last4 || "—"}`} />
              <div class="flex items-center justify-between pt-4 border-t border-[var(--border)]">
                <span class="text-[var(--text-muted)] font-bold">Total fare</span>
                <span class="text-2xl font-black text-[var(--text-main)]">{usd(fare())}</span>
              </div>
              {form.isSubmitted && <div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center text-sm font-bold text-emerald-600">🎉 Booking confirmed!</div>}
            </div>
          )}

          <div class="flex items-center justify-between mt-8 pt-6 border-t border-[var(--border)]">
            <button type="button" onclick={back} disabled={step === 0} class={btnGhost}>Back</button>
            <div class="flex items-center gap-4">
              {flight() && <span class="text-[var(--text-main)] font-black">{usd(fare())}</span>}
              {step < STEPS.length - 1 ? (
                <button type="button" onclick={next} class={btnPrimary}>Continue</button>
              ) : form.isSubmitted ? (
                <button type="button" onclick={resetBooking} class={btnPrimary}>＋ New booking</button>
              ) : (
                <button type="button" onclick={form.handleSubmit(onSubmit)} disabled={form.isSubmitting} class={btnConfirm}>{form.isSubmitting ? "Booking…" : "Confirm booking"}</button>
              )}
            </div>
          </div>
        </section>

        <aside class="bg-[var(--code-bg)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div class="flex border-b border-slate-800 text-[11px] font-bold">
            {["values", "errors", "touched", "payload"].map((t) => (
              <button type="button" onclick={() => (devTab = t)} class={devTab === t ? "flex-1 py-2.5 text-indigo-400 bg-indigo-500/10 uppercase tracking-wider" : "flex-1 py-2.5 text-slate-500 hover:text-slate-300 uppercase tracking-wider"}>{t}</button>
            ))}
          </div>
          {devTab === "payload" && <div class="px-4 pt-3 text-[10px] text-slate-500 leading-snug">The object you'd POST on submit — live <span class="text-slate-300">values</span> plus computed <span class="text-slate-300">total</span> / <span class="text-slate-300">valid</span> / <span class="text-slate-300">dirty</span>.</div>}
          <pre class="text-[11px] font-mono p-4 text-slate-300 overflow-auto max-h-[420px] leading-relaxed">
            {devTab === "values" && JSON.stringify(form.values, null, 2)}
            {devTab === "errors" && JSON.stringify(form.errors, null, 2)}
            {devTab === "touched" && JSON.stringify(form.touched, null, 2)}
            {devTab === "payload" && JSON.stringify({ total: fare(), valid: form.isValid, dirty: form.isChanged, ...form.values }, null, 2)}
          </pre>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div class="flex items-start justify-between gap-4">
      <span class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{k}</span>
      <span class="text-sm text-[var(--text-main)] text-right">{v}</span>
    </div>
  );
}
