//! OpenTF Web intermediate representations — the compiler backbone.
//!
//! This crate defines the several small, domain-specific IRs described in
//! `ARCHITECTURE.md` §4: View, Reactivity, Server, Route, and the assembling
//! `ComponentIR` / `ProjectGraph`. All IRs are target-agnostic: nothing here
//! references DOM APIs, HTML strings, or any single rendering strategy.
//!
//! Status: foundation. Types are intentionally minimal and will grow as the
//! pending decisions in `ARCHITECTURE.md` §7 are settled.

pub mod identity;
pub mod view;
pub mod reactivity;
pub mod server;
pub mod route;
pub mod component;

pub use component::{ComponentIR, ProjectGraph};
pub use identity::{ComponentId, ExpressionId, NodeId, SignalId};
