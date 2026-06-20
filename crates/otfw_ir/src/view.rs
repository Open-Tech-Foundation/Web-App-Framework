//! View IR — see `ARCHITECTURE.md` §4.2.
//!
//! A tree mirroring component structure (kept as a tree, not a flat list, since
//! SSR/SSG walk structure to emit HTML and structural addressing needs a tree).
//! Dynamic holes reference an `ExpressionId` resolved in the Reactivity IR.

use crate::identity::ExpressionId;

/// A node in the view tree.
#[derive(Debug, Clone, PartialEq)]
pub enum ViewNode {
    Element {
        tag: String,
        props: Vec<Prop>,
        children: Vec<ViewNode>,
    },
    Component {
        name: String,
        props: Vec<Prop>,
        children: Vec<ViewNode>,
    },
    Text(String),
    /// A dynamic hole; what fills it and when it updates lives in the Reactivity IR.
    Dynamic {
        expr: ExpressionId,
    },
    /// The component's children slot (`{children}`): the light-DOM nodes the
    /// parent passed in, captured at connect and placed here (SPEC §4.5).
    Children,
    /// A keyed list from an `array.map(cb)` expression (SPEC §5.4.4). `source` is
    /// the data expression (the chain before `.map`, with `.value` injected on
    /// outer signals); `item` is the callback body rendered per element, with
    /// `item_param` reified as a per-item signal; `key` is an optional `key={…}`
    /// expression evaluated against the plain item.
    List {
        source: ExpressionId,
        item_param: String,
        index_param: Option<String>,
        item: Box<ViewNode>,
        key: Option<ExpressionId>,
    },
    Fragment(Vec<ViewNode>),
}

/// A property/attribute on an element or component.
///
/// `value` distinguishes static literals from dynamic expressions so a backend
/// can apply static props once and only wire effects for dynamic ones.
#[derive(Debug, Clone, PartialEq)]
pub struct Prop {
    pub name: String,
    pub value: PropValue,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PropValue {
    /// A compile-time constant applied once.
    Static(String),
    /// A dynamic expression resolved via the Reactivity IR.
    Dynamic(ExpressionId),
}
