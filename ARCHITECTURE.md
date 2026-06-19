# Architecture

> **Read this first.** This document is the authoritative description of the
> framework's compiler and runtime architecture. All design decisions and
> conventions live here. Code must conform to this document; when code and this
> document disagree, this document is the source of truth until amended.
>
> **Status:** Living document. Sections marked _(decided)_ are settled.
> Sections marked _(open)_ are under active design and will be expanded in
> later passes.

---

## Terminology _(decided — read this to avoid confusion)_

These words are used precisely throughout this document. They are **not**
interchangeable.

| Term | What it is | Ours? | Language | Runs at |
|------|-----------|-------|----------|---------|
| **Parser** (`oxc`) | turns source text into a standard ESTree-compatible AST | 3rd-party | Rust | build time |
| **Compiler** | our Stages 1–4: AST → Semantic Model → **IRs** → generated code. The brain. | ours | Rust | build time |
| **IR** | the compiler's internal data structures — the backbone (View / Reactivity / Server / Route / Metadata) | ours | Rust | build time |
| **Project Graph** | the assembled cross-module component + dependency graph | ours | Rust | build time |
| **Target / Backend** | a consumer of the IRs that emits code for one mode (CSR / Hydrate / SSG / SSR / API) | ours | Rust | build time |
| **Bundler** (`Rolldown`) | links generated modules + dependencies into shippable assets | 3rd-party (library) | Rust | build time |
| **Orchestrator / Toolchain** | our dev server + build driver: runs the compiler, drives the bundler, owns the incremental cache + HMR | ours | Rust | build time |
| **Runtime** | the small JS library shipped to and executed in the **browser** — DOM operations, reactivity, hydration | ours | JS | in the browser |

Mental model in one line:

> The **toolchain** runs the **compiler** (which uses the **parser**) to produce
> **IRs**, which **backends** turn into code that the **bundler** links — and the
> result ships alongside our **runtime** that executes in the browser.

The two most-confused terms:

- **Compiler vs Runtime** — the compiler runs at *build time* and produces code;
  the runtime is *shipped code* that executes in the browser. Different machines,
  different languages.
- **Bundler vs Toolchain** — the bundler (Rolldown) is one *engine* we use; the
  toolchain is *our* program that drives it (plus the compiler, cache, dev
  server). We own the toolchain; we depend on the bundler.

---

## 1. Vision

A **fullstack web framework on a Rust foundation**. A single compiler and
toolchain spans the entire application:

- **UI** — components authored in JSX/TSX, compiled to native DOM operations.
- **Rendering** — client-side rendering (CSR), hydration, static generation
  (SSG), and server-side rendering (SSR), all produced from one source.
- **API layer** — server endpoints and server functions compiled in the same
  graph as the UI, sharing types and the module graph.

The defining principle: **one source, many domain-specific IRs, many targets.**
The compiler derives several small, focused IRs from the same AST (View,
Reactivity, Server, Route, Metadata) rather than one universal IR. Every output
(CSR, hydrate, SSG, SSR, API) is a pure function of these IRs. No target
re-derives application structure on its own.

---

## 2. Design principles _(decided)_

1. **The IRs are the single source of truth.** Targets consume the IRs; they
   never re-analyze source. This is what guarantees server/client agreement.
   Prefer several small, domain-specific IRs over one universal IR.
2. **Semantics over syntax.** Reactivity, props, and data flow are derived from
   resolved scope bindings, never from identifier names or textual position.
3. **Everything is content-addressed.** Inputs and artifacts are fingerprinted;
   the same input always yields the same output. Builds are incremental by
   default.
4. **Stages have hard boundaries.** Each stage has a typed, serializable input
   and output. Stages can be cached, swapped, or run out-of-process.
5. **Structural addressing, never positional.** Dynamic regions ("slots") are
   addressed by a compile-time path from the component root, not by runtime
   traversal counters.

---

## 3. Compiler pipeline _(decided)_

```
.jsx / .tsx  +  app/ routes
   │  (1) Parse
   ▼
Standard AST            ESTree-compatible (oxc)
   │  (2) Bind / Resolve
   ▼
Semantic Model          scopes + bindings + reactive classification + types
   │  (3) Lower  →  domain-specific IRs
   ▼
   ├── View IR          element/component/text/dynamic tree
   ├── Reactivity IR    signals + dependency sets
   ├── Server IR        loaders / queries / actions
   ├── Route IR         file-based routes → components
   └── Metadata IR      imports/exports, env, fingerprints
   │  (assembled into)
   ▼
Project Graph           components + dependency graph across the app
   │  (4) Codegen / consumers
   ▼
Backends:  CSR  │  Hydrate  │  SSG  │  SSR  │  Routing  │  API  │  Tooling
```

### Stage responsibilities

| Stage | Input | Output | Notes |
|-------|-------|--------|-------|
| 1. Parse | source text | Standard AST | oxc; spec-compliant ESTree + TS + JSX. No transformation. |
| 2. Bind/Resolve | AST | Semantic Model | scope tree, binding resolution, reactive classification, type info. |
| 3. Lower | Semantic Model | **domain-specific IRs** | View, Reactivity, Server, Route, Metadata; see §4. |
| — Assemble | per-module IRs | **Project Graph** | components + cross-module dependency graph; see §4.6. |
| 4. Codegen | Project Graph | backend modules | each backend is a pure function of the IRs; see §6. |

### Parser: oxc _(decided)_

Chosen for: Rust-native, closest to the ESTree spec, first-class TS + JSX, and a
built-in semantic/resolver layer that seeds Stage 2 (scopes + bindings) rather
than requiring us to rebuild binding analysis.

---

## 4. The IRs — the backbone _(open, foundational)_

We use **several small, domain-specific IRs**, not one universal IR. Each IR
answers one question; they are derived from the same AST and tied together by the
Project Graph (§4.6). This keeps each IR small and evolvable, and avoids the
"500-node mega-enum" that becomes unmaintainable as the framework grows.

All IRs are **target-agnostic** (no DOM APIs, no HTML strings, no single
rendering strategy), **serializable**, and **versioned**.

### 4.1 Why multiple IRs _(decided)_

The compiler answers different questions for different concerns — what the UI
looks like, what updates, what runs on the server, how routes map to components.
Each gets its own IR. A single giant IR couples unrelated concerns and grows
without bound; small IRs stay focused and compose through the graph.

### 4.2 View IR _(open)_

A **tree** mirroring component structure (kept as a tree, not a flat list —
SSR/SSG walk structure to emit HTML, and structural addressing needs a tree).

```rust
pub enum ViewNode {
    Element   { tag: String, props: Vec<Prop>, children: Vec<ViewNode> },
    Component { name: String, props: Vec<Prop>, children: Vec<ViewNode> },
    Text(String),
    Dynamic   { expr: ExpressionId },   // a dynamic hole; see Reactivity IR
    Fragment(Vec<ViewNode>),
}
```

Dynamic holes are addressed by a **structural path** from the component root and
reference an `ExpressionId` resolved in the Reactivity IR.

### 4.3 Reactivity IR _(open)_

What is dynamic and what each dynamic region depends on. Decouples "where the
hole is" (View IR) from "what fills it and when it updates."

```rust
pub struct SignalInfo { /* provenance: state | derived | ref | prop */ }

pub enum Dynamic {
    Text { expr: ExpressionId, deps: Vec<SignalId> },
    Attr { name: String, expr: ExpressionId, deps: Vec<SignalId> },
    Event { name: String, handler: ExpressionId },
}
```

### 4.4 Server IR _(open)_

Server-side concerns extracted from the component graph — data loading and
mutations — so SSR and data fetching are first-class.

```rust
pub enum ServerNode {
    Loader(LoaderInfo),
    Query(QueryInfo),
    Action(ActionInfo),
}
```

### 4.5 Route IR + Metadata IR _(open)_

- **Route IR** — file-based routes mapped to components.

  ```rust
  pub struct Route { path: String, component: ComponentId }
  ```

- **Metadata IR** — imports/exports, module environment (`client | server |
  shared`), and fingerprints; the contract between compiler and runtime/server.

### 4.6 Component IR + Project Graph _(open)_

A `ComponentIR` bundles the per-component IRs; the `ProjectGraph` connects them
across the whole app. This is the unit codegen, SSR, routing, and tooling
consume.

```rust
pub struct ComponentIR {
    id: ComponentId,
    view: ViewNode,
    signals: Vec<SignalInfo>,
    imports: Vec<ImportInfo>,
    exports: Vec<ExportInfo>,
}

pub struct ProjectGraph {
    components: HashMap<ComponentId, ComponentIR>,
    dependencies: Graph<ComponentId>,
}
```

### 4.7 Invariants _(decided)_

- Dynamic-hole addresses are structural and stable across recompiles of
  unchanged code (never positional/counter-based).
- Every dynamic region declares its dependency set explicitly (Reactivity IR).
- Every IR node carries source-position mapping (for source maps, §5.4).
- Every IR is serializable to a stable on-disk format with a schema version.

### 4.8 Identity & references _(decided)_

There are **two distinct kinds of identity**, and they must never be conflated.
Conflating them causes both slow incremental builds and brittle hydration.

**1. Interned IDs** — in-memory, per-build, arena indices. Scratch only.

```rust
struct ExpressionId(u32);   // newtype, Copy, opaque
struct SignalId(u32);
struct NodeId(u32);
```

- Cheap (`Copy`, cache-friendly), allocated while lowering into an arena.
- **Newtype-wrapped** so the type system forbids passing a `SignalId` where an
  `ExpressionId` is expected.
- **Never cross a build or module boundary as a contract.** Never serialized as
  the durable reference.

**2. Stable keys** — serialized, survive recompiles. Used for anything that must
be stable:

- **`ComponentId`** = derived from `(canonical module path, export name)` — a
  stable key, _not_ an index. Project Graph edges must survive recompiles.
- **Hydration slot address** = the **structural path** (e.g. `[0,1]`), _not_
  `NodeId`. `NodeId` is an unstable interning detail; the path is stable as long
  as the markup shape is unchanged.

**Scoping**

| Ref | Scope | Backing |
|-----|-------|---------|
| `ExpressionId`, `SignalId`, `NodeId` | per-**component** arena | interned `u32` |
| `ComponentId` | **global** (Project Graph) | stable key (path + export name) |
| cross-module symbol ref | `(ComponentId, LocalId)` | pair |

**Gluing the IRs**

- One **arena per `ComponentIR`** holds the expression/signal/node tables. Inside
  a component, View IR's `Dynamic { expr }`, Reactivity IR's `deps: Vec<SignalId>`,
  and the expression table share one valid index space — lookups are array
  indexing.
- View IR → Reactivity IR by `ExpressionId`.
- Project Graph → components by `ComponentId`; edges are `ComponentId → ComponentId`.

**Rules _(decided)_**

1. Interned IDs are scratch — never persisted as a contract. Anything persisted
   (cache keys, hydration markers, graph edges) uses a **stable key**.
2. Strings (tags, prop names) are **interned** via oxc's `Atom` and referenced by
   handle — not `String` copies throughout the IR.

The payoff: incremental rebuilds compare stable keys + fingerprints (not indices,
which churn every parse), and hydration addresses by structural path (not
`NodeId`, which churns).

---

## 5. Production subsystems _(open)_

These make the compiler a production-grade, incremental build system rather than
a single-shot transformer. Influences: **Bazel** (hermetic, content-addressed
actions), **Buck2** (query-based graph, remote execution), **Turborepo**
(task/dep graph + caching), **rust-analyzer/salsa** (incremental query DB).

### 5.1 Semantic Database

A **query-based, incremental** store (salsa-style). Resolved scopes, bindings,
types, and reactive classifications are memoized queries keyed by input
fingerprints. Editing one file invalidates only the queries that depended on it.
This database backs both the batch compiler and (future) editor tooling/LSP.

### 5.2 Module graph

Nodes = modules, edges = imports. Each module is tagged by **environment**:
`client`, `server`, or `shared`. The graph drives:

- correct code splitting and the client/server boundary,
- incremental rebuilds (recompile changed modules + downstream affected only),
- dead-code and unused-export analysis.

Comparable to Turborepo's task graph and Buck2's target graph.

### 5.3 Caching, fingerprints, incrementality

- **Fingerprints** — content hashes of every input (source, config, compiler
  version, dependency fingerprints). A node's cache key is the hash of its
  inputs, Bazel-style.
- **Content-addressed artifact store** — outputs keyed by fingerprint; identical
  inputs are never recomputed.
- **Incremental** — only nodes whose fingerprint changed, plus their affected
  dependents (graph reachability), are rebuilt.

### 5.4 Source maps

Source-position mapping is threaded through **every** stage (AST → Semantic
Model → IR → codegen) so generated code in any target maps back to the original
JSX/TSX. The IR holds spans natively (§4.4).

### 5.5 Compiler artifacts

Stable, serialized outputs of a build:

- serialized **IRs** per module + the **Project Graph** (schema-versioned),
- generated backend modules (CSR / hydrate / SSG / SSR / API),
- **source maps**,
- a **dependency metadata manifest** (module graph, environments, fingerprints,
  asset references) — the contract between the compiler and the runtime/server.

### 5.6 Serialization

Every cross-stage and on-disk structure (Semantic Model, IR, manifests) has an
explicit, versioned schema. This enables caching, out-of-process backends, and
debuggability (artifacts are inspectable).

---

## 6. Targets / backends _(open)_

Each backend is a **pure function of the IRs / Project Graph**. Adding a target
= adding a consumer; Stages 1–3 never change.

- **CSR** — build skeleton + resolve slots by path + wire effects.
- **Hydrate** — adopt existing skeleton by path (no node creation) + wire
  effects. Mismatches are detected at a specific slot path and reported, never
  silent.
- **SSG** — IR → HTML at build time; emit hydration markers only where structure
  is variable (lists/conditionals).
- **SSR** — per-request HTML from the IR; streaming-capable. Shares the SSG path.
- **API** — server endpoints / server functions compiled in the same graph,
  sharing types and the module graph with the UI.

---

## 7. Open questions

Tracked here as the discussion progresses:

- Exact schema of each IR (View, Reactivity, Server, Route, Metadata) (§4).
- Reactive binding classification rules and dependency-set computation (§2.2).
- Props/data channel across the component boundary (typed properties vs
  attributes).
- Client/server boundary semantics (server functions, serialization contract).
- Hydration mismatch detection and recovery policy.
- Artifact on-disk format and cache key composition.

---

## 8. Toolchain & runtime _(decided)_

The framework owns its toolchain and its runtime, and uses **Rolldown** as the
bundling engine. **We do not build on Vite.**

### 8.1 Layering

```
Orchestrator / Toolchain (Rust)      ← owns dev server, build, HMR, incremental cache
  ├─ Compiler (oxc → IRs → codegen)  ← §3
  ├─ Rolldown (used as a library)    ← bundling engine + module linking
  └─ Runtime (shipped JS)            ← DOM ops, reactivity, hydration (browser)
```

### 8.2 Decisions

1. **Bundler = Rolldown, from the start.** Rust-native and from the same family
   as `oxc` (it uses oxc internally), so there is no JS↔Rust bridge on the hot
   path and we can share data structures (atoms, module graph) instead of
   serializing across a boundary.
2. **We own the orchestrator.** Dev server, build driver, HMR, and the
   incremental cache (§5) are ours. Rolldown is invoked as a library — it
   consumes our module graph / dependency metadata rather than re-deriving it.
3. **We do not write a bundler from scratch.** Module resolution, tree-shaking,
   npm compatibility, CSS, and the asset pipeline come from Rolldown.
4. **The runtime is independent of the toolchain.** It is shipped JS that runs in
   the browser; it has no dependency on the bundler or dev server.

### 8.3 Why not a plugin to an existing host

Our model is fullstack — SSR, an API layer, a Server IR, a Project Graph, and an
incremental cache. A client-oriented host's plugin lifecycle constrains those
pieces. Owning the orchestrator keeps the fullstack concerns first-class instead
of bolted on.
</content>
</invoke>
