// A worker shipped by a (symlinked) dependency. The string marker (not a comment,
// which minification strips) lets the e2e assert this file's bundle was served.
self.onmessage = (e) => self.postMessage("MARKER_DEP_WORKER:" + e.data);
