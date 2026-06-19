//! Reactivity IR — see `ARCHITECTURE.md` §4.3.
//!
//! Decouples *where* a dynamic region is (View IR) from *what fills it and when
//! it updates*. Every dynamic region declares its dependency set explicitly.

use crate::identity::{ExpressionId, SignalId};

/// Provenance of a reactive signal. The compiler classifies bindings here
/// instead of relying on identifier names (ARCHITECTURE.md §2, principle 2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignalKind {
    State,
    Derived,
    Ref,
    Prop,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignalInfo {
    pub id: SignalId,
    pub kind: SignalKind,
    /// Source-level name (for diagnostics/source maps only — not used as identity).
    pub name: String,
}

/// A dynamic binding: an expression, what it drives, and the signals it depends on.
#[derive(Debug, Clone, PartialEq)]
pub enum Dynamic {
    Text {
        expr: ExpressionId,
        deps: Vec<SignalId>,
    },
    Attr {
        name: String,
        expr: ExpressionId,
        deps: Vec<SignalId>,
    },
    Event {
        name: String,
        handler: ExpressionId,
    },
}
