//! OTF Web compiler — Stages 1–4 (see `ARCHITECTURE.md` §3).
//!
//!   source -> (1) parse -> AST
//!          -> (2) bind/resolve -> Semantic Model
//!          -> (3) lower -> domain-specific IRs (otfw_ir)
//!          -> (4) codegen -> backend modules
//!
//! Status: foundation. Stages 1–3 (parse, bind/resolve, lower to View IR) are
//! implemented; Stage 4 (codegen) is a stub. The IR types they target already
//! exist in `otfw_ir`.

pub use otfw_ir;

/// Stage 0 (front-end): lower `.mdx`/`.md` to JSX source for the pipeline below.
pub mod mdx;

/// Stage 1: Parse — source text → AST. Backed by oxc.
pub mod parse;

/// Stage 2: Bind / Resolve into the Semantic Model.
pub mod semantic;

/// Stage 3: Lower the Semantic Model into the domain-specific IRs.
pub mod lower;

/// Stage 4: Codegen — IR consumers per target (CSR / Hydrate / SSG / SSR / API).
pub mod codegen;

/// Module graph (§5.2): module → dependency edges + fingerprints, for on-demand
/// compilation and precise incremental rebuilds.
pub mod graph;
