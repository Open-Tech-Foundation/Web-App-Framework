// Live demo for the Portal guide: escape a clipping ancestor vs native <dialog>.

import { Portal } from "@opentf/web";

export default function PortalDemo() {
  let portalOpen = $state(false);
  const dialogRef = $ref();

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
            onclick={() => (portalOpen = true)}
          >
            Open portaled modal
          </button>
          {portalOpen && (
            <Portal to="body">
              <div
                className="demo-portal-backdrop"
                onclick={() => (portalOpen = false)}
              >
                <div
                  className="demo-portal-modal"
                  onclick={(e) => e.stopPropagation()}
                >
                  <div className="demo-portal-modal-title">Portaled modal</div>
                  <p className="demo-portal-modal-body">
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