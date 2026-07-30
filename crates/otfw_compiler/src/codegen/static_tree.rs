//! Recognizing compile-time-constant view subtrees, shared by the backends.
//!
//! A subtree with no holes, listeners, refs or components is fully determined at
//! compile time. That lets a backend emit it as one unit instead of once per node:
//! the hydrate backend claims its root and skips the walk (the server HTML already
//! holds the attributes, and claiming an element advances the cursor past its whole
//! subtree), which is what keeps a large static page from emitting a `cursor` and a
//! `claimElement`/`skipNode` per node purely to arrive back where it started.

use otfw_ir::view::{Prop, PropValue, ViewNode};

/// True when `node` and everything under it is compile-time constant: plain
/// elements and text carrying only static attributes — nothing that needs a JS
/// handle, an event listener, or a reactive binding.
pub fn is_static(node: &ViewNode) -> bool {
    match node {
        ViewNode::Text(_) => true,
        ViewNode::Element { props, children, .. } => {
            props.iter().all(is_static_prop) && children.iter().all(is_static)
        }
        // Everything else needs wiring: a component self-adopts and owns its own
        // structure, and holes, lists and `{children}` slots are dynamic by nature.
        _ => false,
    }
}

/// A prop that needs no work beyond what the server HTML already carries.
fn is_static_prop(prop: &Prop) -> bool {
    // A spread has an empty name and can carry anything; `ref` hands the node to
    // user code; `on*` needs a handler attached. An `on*` prop that is somehow
    // *static* is excluded too rather than special-cased — the backends disagree on
    // whether to serialize it, so it is not something to fold into a static unit.
    if prop.name.is_empty() || prop.name == "ref" || is_event_name(&prop.name) {
        return false;
    }
    matches!(prop.value, PropValue::Static(_) | PropValue::Boolean)
}

/// The `on*` test the backends use (`ssg::is_event`, `csr::is_event`).
fn is_event_name(name: &str) -> bool {
    name.len() > 2 && name.starts_with("on")
}

#[cfg(test)]
mod tests {
    use super::*;
    use otfw_ir::identity::ExpressionId;

    fn el(tag: &str, props: Vec<Prop>, children: Vec<ViewNode>) -> ViewNode {
        ViewNode::Element { tag: tag.to_string(), props, children }
    }

    fn static_prop(name: &str) -> Prop {
        Prop { name: name.to_string(), value: PropValue::Static("v".into()) }
    }

    #[test]
    fn plain_nested_markup_is_static() {
        let tree = el(
            "section",
            vec![static_prop("class")],
            vec![
                el("h2", vec![], vec![ViewNode::Text("Title".into())]),
                el("p", vec![static_prop("id")], vec![ViewNode::Text("Body".into())]),
            ],
        );
        assert!(is_static(&tree));
    }

    #[test]
    fn text_alone_is_static() {
        assert!(is_static(&ViewNode::Text("x".into())));
    }

    #[test]
    fn a_hole_anywhere_below_makes_it_dynamic() {
        let tree = el(
            "div",
            vec![],
            vec![el("span", vec![], vec![ViewNode::Dynamic { expr: ExpressionId(0) }])],
        );
        assert!(!is_static(&tree), "a nested hole must disqualify the whole subtree");
    }

    #[test]
    fn a_component_is_never_static() {
        let tree = el(
            "div",
            vec![],
            vec![ViewNode::Component { name: "Card".into(), props: vec![], children: vec![] }],
        );
        assert!(!is_static(&tree), "a component self-adopts and owns its own structure");
    }

    #[test]
    fn slots_and_lists_are_never_static() {
        assert!(!is_static(&el("div", vec![], vec![ViewNode::Children])));
    }

    #[test]
    fn ref_event_and_spread_props_disqualify() {
        for prop in [
            Prop { name: "ref".into(), value: PropValue::Static("r".into()) },
            Prop { name: "onClick".into(), value: PropValue::Static("f".into()) },
            Prop { name: String::new(), value: PropValue::Static("o".into()) },
        ] {
            let name = prop.name.clone();
            assert!(
                !is_static(&el("div", vec![prop], vec![])),
                "prop {name:?} must disqualify the element"
            );
        }
    }

    #[test]
    fn a_dynamic_attribute_disqualifies() {
        let prop = Prop { name: "class".into(), value: PropValue::Dynamic(ExpressionId(0)) };
        assert!(!is_static(&el("div", vec![prop], vec![])));
    }
}
