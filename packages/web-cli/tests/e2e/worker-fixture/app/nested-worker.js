// The nested worker (leaf). MARKER_NESTED_WORKER lets the e2e assert this file's
// contents were actually bundled/served, not a 404 stub.
self.onmessage = (e) => self.postMessage("MARKER_NESTED_WORKER:" + e.data);
