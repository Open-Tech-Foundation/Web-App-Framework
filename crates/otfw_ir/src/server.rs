//! Server IR — see `ARCHITECTURE.md` §4.4.
//!
//! Server-side concerns extracted from the component graph (data loading and
//! mutations) so SSR and data fetching are first-class.
//!
//! Status: foundation. The info structs are placeholders; their shape is a
//! pending decision (ARCHITECTURE.md §7, client/server boundary).

#[derive(Debug, Clone, PartialEq)]
pub enum ServerNode {
    Loader(LoaderInfo),
    Query(QueryInfo),
    Action(ActionInfo),
}

#[derive(Debug, Clone, PartialEq)]
pub struct LoaderInfo {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryInfo {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActionInfo {
    pub name: String,
}
