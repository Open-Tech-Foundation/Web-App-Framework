// The dev-mode error overlay client. Injected as an inline <script> into the
// served HTML, so it is intentionally a self-contained IIFE with no imports.
//
// It surfaces two error sources, Next.js-style:
//   • compile errors — pushed from the dev server over the HMR WebSocket
//     ({ type: "error" }); a successful rebuild sends { type: "reload" }. The message
//     carries the position the compiler reported (`file`, `line`, `column`) and the
//     code frame around it, which the panel shows verbatim — the whole point is that
//     the developer can go straight to the line rather than read prose and guess.
//   • runtime errors — the runtime's `otfw:error` window event (render/effect/
//     mount/route), plus uncaught `error` / `unhandledrejection`. Their stacks point
//     at the dev server's chunk URLs (`/__route/<base64>.js`), which say nothing on
//     their own, so frames are rewritten back to the source file they were built
//     from before being shown.
// `otfw:error-clear` (a good navigation) and a successful reload dismiss it — except
// for a compile error, which describes the *build*, not the render. A module that
// fails to compile is served as a stub that renders fine, so the router reports a
// clean navigation a moment later; letting that dismiss the panel would flash the
// diagnostic and hide it. Only a rebuild (→ `reload`) or the user clears that one.

export const overlayClient = `(() => {
  // The project root, stamped in by the dev server, so paths decoded out of chunk
  // URLs read the way they do in an editor: relative to the project.
  const ROOT = window.__otfwRoot || "";
  const rel = (p) => (ROOT && p.indexOf(ROOT + "/") === 0 ? p.slice(ROOT.length + 1) : p);
  const C = { bg:"rgba(8,8,12,.86)", panel:"#161618", line:"#2c2c30", red:"#ff5c5c", head:"#2a1416", text:"#ececf0", dim:"#9aa0a6", frame:"#0f0f12" };
  let root, titleEl, msgEl, stackEl, frameEl, fileEl, shownKind = null;
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
    fileEl = css(document.createElement("span"), "color:"+C.dim+";font-size:12px;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:right");
    const close = css(document.createElement("button"), "border:0;background:transparent;color:"+C.dim+";cursor:pointer;font-size:18px;line-height:1;padding:0 2px");
    close.textContent = "\\u2715"; close.title = "Dismiss (Esc)"; close.onclick = hide;
    bar.append(badge, titleEl, spacer, fileEl, close);
    msgEl = css(document.createElement("div"), "padding:16px 18px 12px;color:"+C.text+";font-size:14px;white-space:pre-wrap;line-height:1.55");
    frameEl = css(document.createElement("pre"), "margin:0 18px 4px;padding:12px 14px;background:"+C.frame+";border:1px solid "+C.line+";border-radius:8px;color:"+C.text+";font-size:12.5px;line-height:1.5;white-space:pre;overflow:auto");
    stackEl = css(document.createElement("pre"), "margin:0;padding:12px 18px 18px;color:"+C.dim+";font-size:12.5px;white-space:pre-wrap;overflow:auto;flex:1");
    panel.append(bar, msgEl, frameEl, stackEl);
    root.appendChild(panel);
    root.addEventListener("click", (e) => { if (e.target === root) hide(); });
    document.body.appendChild(root);
  }

  // A dev chunk URL (/__route|__worker/<base64url of the absolute path>.js) names the
  // file it was built from; decode it so a stack frame reads as a path, not a blob.
  const decodeChunk = (u) => {
    const m = /\\/__(route|worker)\\/([A-Za-z0-9_-]+)\\.js/.exec(u);
    if (!m) return null;
    try { return rel(atob(m[2].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
  };
  const prettyFile = (u) => {
    if (!u) return "";
    const decoded = decodeChunk(u);
    return decoded || String(u).replace(location.origin, "");
  };
  // Rewrite every dev chunk URL in a stack, keeping the :line:col the browser reported
  // (positions are in the served chunk — the compiler does not emit source maps yet, so
  // this says which module the frame is in, not which line of your source).
  const prettyStack = (s) => String(s || "").replace(/https?:\\/\\/[^\\s)]+/g, (u) => {
    const decoded = decodeChunk(u);
    if (!decoded) return u.replace(location.origin, "");
    const pos = /(:\\d+:\\d+)\\)?$/.exec(u);
    return decoded + " (chunk" + (pos ? pos[1] : "") + ")";
  });

  function show(o) {
    ensure();
    shownKind = o.kind || "runtime";
    titleEl.textContent = o.title || "Error";
    fileEl.textContent = o.file || "";
    msgEl.textContent = o.message != null ? String(o.message) : "";
    frameEl.textContent = o.frame || "";
    frameEl.style.display = o.frame ? "block" : "none";
    stackEl.textContent = o.stack || "";
    stackEl.style.display = o.stack ? "block" : "none";
    root.style.display = "flex";
  }
  function hide() { shownKind = null; if (root) root.style.display = "none"; }

  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("error", (e) => show({ title:"Runtime error", message:e.message, stack:prettyStack(e.error && e.error.stack), file:prettyFile(e.filename) }));
  window.addEventListener("unhandledrejection", (e) => { const r = e.reason || {}; show({ title:"Unhandled promise rejection", message:r.message || String(r), stack:prettyStack(r.stack) }); });
  window.addEventListener("otfw:error", (e) => {
    const d = e.detail || {}, ctx = d.context || {}, err = d.error || {};
    const title = (ctx.phase ? "Error during " + ctx.phase : "Runtime error") + (ctx.component ? " \\u2014 <" + ctx.component + ">" : "");
    show({ title, message: err.message || String(err), stack: prettyStack(err.stack), file: ctx.path });
  });
  window.addEventListener("otfw:error-clear", () => { if (shownKind !== "compile") hide(); });

  const url = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/__hmr";
  const connect = () => {
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { m = { type: "reload" }; }
      if (m.type === "reload") location.reload();
      else if (m.type === "error") {
        const where = m.file ? m.file + (m.line ? ":" + m.line + ":" + m.column : "") : prettyFile(m.id);
        show({
          title: "Compile error",
          kind: "compile",
          file: where,
          message: m.message + (m.note ? "\\n\\nnote: " + m.note : ""),
          frame: m.frame,
        });
      }
    };
    ws.onclose = () => setTimeout(connect, 1000);
  };
  connect();
})();`;
