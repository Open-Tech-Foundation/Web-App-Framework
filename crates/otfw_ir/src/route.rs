//! Route IR — see `ARCHITECTURE.md` §4.5.
//!
//! File-based routes mapped to components.

use crate::identity::ComponentId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    /// Route path, e.g. `/`, `/users`, `/users/:id`.
    pub path: String,
    /// The component rendered for this route.
    pub component: ComponentId,
}
