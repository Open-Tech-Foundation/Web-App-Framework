//! Stage 4: Codegen — IR consumers per target (ARCHITECTURE.md §6).
//!
//! Each backend is a pure function of the IRs / Project Graph; adding a target
//! is adding a consumer, never changing Stages 1–3. CSR builds the live DOM +
//! reactivity; SSG emits HTML strings at build time (no DOM, no effects).

pub mod csr;
pub mod ssg;
