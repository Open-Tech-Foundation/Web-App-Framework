// The dev-mode error overlay client. Injected as an inline <script> into the
// served HTML, so it is intentionally a self-contained IIFE with no imports.
//
// It surfaces two error sources, Next.js-style:
//   • compile errors — pushed from the dev server over the HMR WebSocket
//     ({ type: "error" }); a successful rebuild sends { type: "reload" }.
//   • runtime errors — the runtime's `otfw:error` window event (render/effect/
//     mount/route), plus uncaught `error` / `unhandledrejection`.
// `otfw:error-clear` (a good navigation) and a successful reload dismiss it.

export const overlayClient = `(() => {
  const C = { bg:"rgba(8,8,12,.86)", panel:"#161618", line:"#2c2c30", red:"#ff5c5c", head:"#2a1416", text:"#ececf0", dim:"#9aa0a6" };
  let root, titleEl, msgEl, stackEl, fileEl;
  const css = (el, s) => { el.style.cssText = s; return el; };
  function ensure() {
    if (root) return;
    root = css(document.createElement("div"), "position:fixed;inset:0;z-index:2147483647;background:"+C.bg+";display:none;align-items:center;justify-content:center;padding:6vh 4vw;font-family:ui-monospace,SFMono-Regular,Menlo,monospace");
    const panel = css(document.createElement("div"), "max-width:980px;width:100%;max-height:88vh;display:flex;flex-direction:column;background:"+C.panel+";border:1px solid "+C.line+";border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden");
    const bar = css(document.createElement("div"), "display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid "+C.line+";background:"+C.head);
    const badge = css(document.createElement("span"), "font-weight:700;font-size:11px;letter-spacing:.6px;color:#fff;background:"+C.red+";padding:3px 8px;border-radius:6px");
    badge.textContent = "ERROR";
    titleEl = css(document.createElement("span"), "color:"+C.red+";font-weight:600;font-size:14px");
    const spacer = css(document.createElement("span"), "flex:1");
    fileEl = css(document.createElement("span"), "color:"+C.dim+";font-size:12px;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap");
    const close = css(document.createElement("button"), "border:0;background:transparent;color:"+C.dim+";cursor:pointer;font-size:18px;line-height:1;padding:0 2px");
    close.textContent = "\\u2715"; close.title = "Dismiss (Esc)"; close.onclick = hide;
    bar.append(badge, titleEl, spacer, fileEl, close);
    msgEl = css(document.createElement("div"), "padding:16px 18px;color:"+C.text+";font-size:14px;white-space:pre-wrap;line-height:1.55");
    stackEl = css(document.createElement("pre"), "margin:0;padding:0 18px 18px;color:"+C.dim+";font-size:12.5px;white-space:pre-wrap;overflow:auto;flex:1");
    panel.append(bar, msgEl, stackEl);
    root.appendChild(panel);
    root.addEventListener("click", (e) => { if (e.target === root) hide(); });
    document.body.appendChild(root);
  }
  function show(o) {
    ensure();
    titleEl.textContent = o.title || "Error";
    fileEl.textContent = o.file || "";
    msgEl.textContent = o.message != null ? String(o.message) : "";
    stackEl.textContent = o.stack || "";
    root.style.display = "flex";
  }
  function hide() { if (root) root.style.display = "none"; }

  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("error", (e) => show({ title:"Runtime error", message:e.message, stack:e.error && e.error.stack, file:e.filename }));
  window.addEventListener("unhandledrejection", (e) => { const r = e.reason || {}; show({ title:"Unhandled promise rejection", message:r.message || String(r), stack:r.stack }); });
  window.addEventListener("otfw:error", (e) => {
    const d = e.detail || {}, ctx = d.context || {}, err = d.error || {};
    const title = (ctx.phase ? "Error during " + ctx.phase : "Runtime error") + (ctx.component ? " \\u2014 <" + ctx.component + ">" : "");
    show({ title, message: err.message || String(err), stack: err.stack, file: ctx.path });
  });
  window.addEventListener("otfw:error-clear", hide);

  const url = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/__hmr";
  const connect = () => {
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { m = { type: "reload" }; }
      if (m.type === "reload") location.reload();
      else if (m.type === "error") show({ title:"Compile error", message:m.message, file:m.id, stack:m.stack });
    };
    ws.onclose = () => setTimeout(connect, 1000);
  };
  connect();
})();`;
