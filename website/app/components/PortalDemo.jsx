// Live demo for the Portal guide: escape a clipping ancestor vs native <dialog>.
//
// The portaled overlay behaves as a modal dialog: it is labelled, takes focus on open,
// keeps Tab and Shift+Tab inside, closes on Escape or a backdrop click, makes the page
// behind it inert, and returns focus to the button that opened it.

import { Portal } from "@opentf/web";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function PortalDemo() {
  let portalOpen = $state(false);
  const dialogRef = $ref();
  const openerRef = $ref();
  const modalRef = $ref();

  $effect(() => {
    if (!portalOpen) return;
    const page = document.getElementById("app");
    if (page) page.inert = true;
    // The portal relocates its children on connect; focus once they are in place.
    const timer = setTimeout(() => (modalRef?.querySelector(FOCUSABLE) ?? modalRef)?.focus());
    return () => {
      clearTimeout(timer);
      if (page) page.inert = false;
      openerRef?.focus();
    };
  });

  function onModalKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      portalOpen = false;
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...modalRef.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="demo-output demo-output--portal">
      <span className="demo-output-label">Output</span>

      <div className="demo-portal-section">
        <div className="demo-portal-section-title">Portal</div>
        <p className="demo-portal-section-desc">
          The box is <code>overflow: hidden</code>. An inline overlay would be clipped —
          <code>&lt;Portal to="body"&gt;</code> relocates the modal to <code>&lt;body&gt;</code>.
        </p>
        <div className="demo-portal-clip">
          <p className="demo-portal-clip-note">Ancestor clips anything that stays inside.</p>
          <button
            type="button"
            className="demo-portal-btn"
            aria-haspopup="dialog"
            ref={openerRef}
            onclick={() => (portalOpen = true)}
          >
            Open portaled modal
          </button>
          {portalOpen && (
            <Portal to="body">
              <div
                className="demo-portal-backdrop"
                onclick={() => (portalOpen = false)}
                onkeydown={onModalKeyDown}
              >
                <div
                  className="demo-portal-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="portal-demo-title"
                  aria-describedby="portal-demo-body"
                  tabindex="-1"
                  ref={modalRef}
                  onclick={(e) => e.stopPropagation()}
                >
                  <h2 id="portal-demo-title" className="demo-portal-modal-title">Portaled modal</h2>
                  <p id="portal-demo-body" className="demo-portal-modal-body">
                    Lives under <code>&lt;body&gt;</code>, outside the clipped box.
                  </p>
                  <button
                    type="button"
                    className="demo-portal-btn demo-portal-btn--solid"
                    onclick={() => (portalOpen = false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </Portal>
          )}
        </div>
      </div>

      <div className="demo-portal-section">
        <div className="demo-portal-section-title">Native dialog</div>
        <p className="demo-portal-section-desc">
          For modals, <code>&lt;dialog&gt;</code> uses the browser top layer — no portal
          needed. Backdrop and Esc-to-close are built in.
        </p>
        <button
          type="button"
          className="demo-portal-btn demo-portal-btn--dialog"
          onclick={() => dialogRef.showModal()}
        >
          Open native dialog
        </button>
        <dialog ref={dialogRef} className="demo-portal-dialog">
          <div className="demo-portal-modal-title">Native dialog</div>
          <p className="demo-portal-modal-body">
            Top layer, <code>::backdrop</code>, Esc to close — no relocation.
          </p>
          <button
            type="button"
            className="demo-portal-btn demo-portal-btn--solid"
            onclick={() => dialogRef.close()}
          >
            Close
          </button>
        </dialog>
      </div>
    </div>
  );
}