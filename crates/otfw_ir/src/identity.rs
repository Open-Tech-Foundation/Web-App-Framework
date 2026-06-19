//! Identity & references — see `ARCHITECTURE.md` §4.8.
//!
//! Two distinct kinds of identity that must never be conflated:
//!
//! 1. **Interned IDs** — in-memory, per-build arena indices. Cheap, `Copy`,
//!    opaque. Scratch only: never serialized as a durable contract, never cross
//!    a build or module boundary as a reference.
//! 2. **Stable keys** — survive recompiles; used for cache keys, hydration
//!    addresses, and Project Graph edges. `ComponentId` is a stable key.

/// Interned reference to an expression within a single component's arena.
/// Unstable across builds — scratch only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ExpressionId(pub u32);

/// Interned reference to a reactive signal within a single component's arena.
/// Unstable across builds — scratch only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SignalId(pub u32);

/// Interned reference to a View IR node within a single component's arena.
/// Unstable across builds — scratch only. NOT a hydration address (use the
/// structural path for that; see `ARCHITECTURE.md` §4.8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId(pub u32);

/// Stable, global identity for a component: `(canonical module path, export
/// name)`. Survives recompiles, so Project Graph edges remain valid across
/// incremental builds. This is a *stable key*, not an arena index.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ComponentId {
    /// Canonical (normalized, absolute) module path.
    pub module: String,
    /// Exported name within the module (e.g. `default`, `UserList`).
    pub export: String,
}

impl ComponentId {
    pub fn new(module: impl Into<String>, export: impl Into<String>) -> Self {
        Self { module: module.into(), export: export.into() }
    }
}
