//! Resolve the `otfwc` compiler binary for the current platform.
//
// otfwc is a Rust binary. It ships brotli-compressed for every supported platform
// inside this single package under `bin/<platform>-<arch>/otfwc[.exe].br`; the
// host's copy is decompressed on install (and lazily here as a fallback). The
// toolchain (`@opentf/web-cli`) calls `otfwcPath()` to get the executable path.
// `OTFWC_BIN` overrides everything (used in this repo's own dev to point at the
// cargo build). See extract.js for the decompression logic.

export { otfwcPath } from "./extract.js";
