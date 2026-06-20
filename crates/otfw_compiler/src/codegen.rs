//! Stage 4: Codegen — IR consumers per target (ARCHITECTURE.md §6).
//!
//! Each backend is a pure function of the IRs / Project Graph; adding a target
//! is adding a consumer, never changing Stages 1–3. The first backend is CSR.

pub mod csr;
