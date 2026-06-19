//! Component IR + Project Graph — see `ARCHITECTURE.md` §4.6.
//!
//! `ComponentIR` bundles the per-component IRs; `ProjectGraph` connects them
//! across the whole app. This is the unit codegen, SSR, routing, and tooling
//! consume.

use std::collections::HashMap;

use crate::identity::ComponentId;
use crate::reactivity::SignalInfo;
use crate::view::ViewNode;

/// Everything the backends need about a single component.
///
/// The expression/signal/node tables live in one arena per component, so the
/// interned IDs used by `view` and `signals` share a valid index space
/// (ARCHITECTURE.md §4.8).
#[derive(Debug, Clone, PartialEq)]
pub struct ComponentIR {
    pub id: ComponentId,
    pub view: ViewNode,
    pub signals: Vec<SignalInfo>,
    pub imports: Vec<ImportInfo>,
    pub exports: Vec<ExportInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportInfo {
    pub source: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportInfo {
    pub name: String,
}

/// The assembled cross-module component + dependency graph.
///
/// Edges are keyed by the stable `ComponentId` so they survive incremental
/// recompiles (ARCHITECTURE.md §4.8). A simple adjacency map for now; a richer
/// graph representation is a pending decision.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProjectGraph {
    pub components: HashMap<ComponentId, ComponentIR>,
    /// `component -> components it depends on`.
    pub dependencies: HashMap<ComponentId, Vec<ComponentId>>,
}

impl ProjectGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, component: ComponentIR) {
        self.components.insert(component.id.clone(), component);
    }
}
