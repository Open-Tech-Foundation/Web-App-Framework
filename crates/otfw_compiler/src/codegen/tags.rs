//! Custom-element tag assignment — collision-free addressing (ARCHITECTURE.md §6).
//!
//! A Custom Element name lives in a single, process-global `CustomElementRegistry`.
//! Deriving a tag from the bare component identifier (`Counter` → `web-counter`)
//! means any two components that happen to share an identifier — in different files
//! or packages — fight over the same slot and the second `define` throws. The
//! compiler is a per-module front-end and never resolves a callee's module, so the
//! tag scheme must be collision-free *without* cross-module resolution:
//!
//! - **User components** register under `web-<kebab>-<hash(module_id)>`, unique per
//!   defining module, exposed on the class as `static tag`. A call site addresses
//!   them through a binding that already carries the tag — the imported binding for
//!   a cross-module use, or the sibling class for a same-module use — so the two
//!   ends agree without recomputing the hash.
//! - **Framework built-ins** keep reserved, stable names (`web-link`,
//!   `web-internal-*`). The compiler knows them by identifier and emits the literal
//!   tag, because some (e.g. `<RawHtml>` injected by the MDX front-end) have no
//!   import binding to reference.

/// Reserved tag for a framework built-in component, or `None` for a user
/// component. These names are addressed by literal tag (no `.tag` binding ref):
/// `RawHtml` is injected by the MDX front-end with no import to reference, and the
/// rest are singletons whose registration lives in the hand-written runtime.
pub fn builtin_tag(name: &str) -> Option<&'static str> {
    Some(match name {
        "Link" => "web-link",
        "Portal" => "web-internal-portal",
        "RawHtml" => "web-internal-raw-html",
        "ErrorBoundary" => "web-internal-error-boundary",
        "ContextProvider" => "web-internal-context-provider",
        _ => return None,
    })
}

/// The tag a component **registers** under (its definition site). Built-ins use
/// their reserved name; every other component is namespaced by a hash of its
/// module id so two same-named components in different modules never collide.
pub fn def_tag(name: &str, module_id: &str) -> String {
    match builtin_tag(name) {
        Some(t) => t.to_string(),
        None => format!("web-{}-{}", kebab(name), module_hash(module_id)),
    }
}

/// The JavaScript **expression** a call site uses to address a component tag:
/// - built-in → the literal reserved tag string;
/// - same-module (sibling) component → the sibling binding's `.tag` (`local_binding`
///   is the emitted class/function name, e.g. `CounterElement` / `Counter_ssg`);
/// - imported component → `Name.tag` (the imported binding is the class/render fn,
///   which carries its own module-namespaced tag).
///
/// Only built-ins ever appear as a literal here; user tags flow through a binding,
/// so the hash never has to be recomputed away from its defining module.
pub fn use_tag_expr(name: &str, module_components: &[String], local_binding: &str) -> String {
    if let Some(t) = builtin_tag(name) {
        return quote(t);
    }
    if module_components.iter().any(|c| c == name) {
        format!("{local_binding}.tag")
    } else {
        format!("{name}.tag")
    }
}

/// A stable, readable CSS hook for a component host: `web-<kebab>`, independent of
/// the (possibly hashed) registry tag. The compiler stamps this as a class on every
/// component host so authors can style hosts (`display`, layout) by a stable name —
/// classes are not registry-unique, so two same-named components sharing this hook
/// is fine for CSS even when their registry tags differ. See `ARCHITECTURE.md` §6.
pub fn css_hook(name: &str) -> String {
    format!("web-{}", kebab(name))
}

/// `Counter` → `counter`, `UserList` → `user-list`.
pub fn kebab(name: &str) -> String {
    let mut out = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                out.push('-');
            }
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// A short, deterministic hash of the module id (FNV-1a, low 32 bits → 8 hex
/// chars). Stable for a given module id with no external dependency; collisions
/// across a project's module set are negligible at 32 bits.
fn module_hash(module_id: &str) -> String {
    const OFFSET: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut h = OFFSET;
    for b in module_id.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(PRIME);
    }
    format!("{:08x}", (h & 0xffff_ffff) as u32)
}

/// Quote a reserved tag (only `[a-z0-9-]`) as a JS string literal.
fn quote(tag: &str) -> String {
    format!("\"{tag}\"")
}
