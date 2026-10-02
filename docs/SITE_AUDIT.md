# Site documentation audit

Reviewed on 2026-10-02 against the framework and plugin source in this checkout,
the website's locked published dependencies, and official esdev/Cloudflare guidance.

## Scope and result

Reviewed all 65 route sources, associated live demos and shared layouts, plus the
404 page. Corrected stale tooling instructions, misleading behavior claims,
inconsistent examples and developer-facing wording. Route sources without a
content edit also received the shared layout correction.

The first pass focused on technical correctness and missed page scope and reading
flow. A follow-up checked the section inventory and navigation across all routes,
then corrected the misplaced setup/testing/contributor sections on Installation,
contributor commands on CLI, duplicated configuration fields and ambiguous page
names. These were omissions in the original review.

This is a source and rendered-page review, not a guarantee that every tutorial
has been executed as a fresh external application or that every widget meets a
complete accessibility standard.

## Main corrections

- Native esdev setup now distinguishes explicit plugin/server wiring from retired
  CLI automation. Loader registration, middleware composition, metadata and
  upstream template limitations are stated where developers need them.
- Examples match runtime behavior: catch-all arrays, loader context/result shape,
  exposed methods instead of copied getters, and hydration-safe clock setup.
  Six examples containing multiple default exports were split into named files.
- Documentation plugins are registered explicitly; sidebar label precedence,
  ordering, edit links, blog generation and release search output are explained.
- Removed unsupported performance guarantees and identified historical benchmark
  data and retired development-server articles. Kept historical measurements intact.
- Corrected broken links/images, nested main landmarks, a duplicate h1, unlabeled
  demo controls and the formatting demo's unsupported JSX helper pattern.
- Installation now covers installing esdev and creating a project, with OS tabs
  and interactive creation first. Build dependencies live in Production Build;
  testing and contributor instructions stay in their respective guides/README.
- Distinct titles and sidebar labels separate Server Setup from Server API and
  Project Configuration from Docs Configuration. The project overview links to
  detailed docs settings instead of repeating them; Introduction provides a
  getting-started reading sequence.

## Verification

- `tsr site-build`: 65 prerendered routes, 63 indexed pages, generated feeds and LLM files.
- `tsr typecheck`: passed.
- Native compiler: all 41 complete JSX/TSX component examples compiled. Explanatory
  fragments were excluded; compilation does not prove application behavior.
- Generated HTML: 66 files including 404; 3,198 internal link/image references
  checked, with no missing targets/anchors, duplicate IDs or landmark issues.
- Chromium preview: visited all 65 routes; checked one h1 and one main, page titles,
  loaded images and labels for visible text/select inputs.
- Chromium interactions: locale selection updates formatting, form input updates
  reactive output, search results highlight matches. No uncaught exceptions.
- `git diff --check`: passed.

## Remaining work

1. Upstream esdev OTF templates still need native config/entry integration. The
   converted starter's production chunk-reference issue blocks fresh-project
   verification and new benchmark measurements. These changes label the limitation;
   they do not fix esdev itself. See [migration status](ESDEV_MIGRATION.md).
2. The website uses released packages independently of the workspace. Pending
   compiler/plugin/search releases need a lockfile update and another production
   preview check before source improvements can be assumed present on the site.
3. SSG still warns about and omits spread attributes in form demos. Hydration
   restores browser bindings; the JSX guide now documents the server-output limit.
4. The Portal guide's custom overlay demo lacks modal semantics, focus containment,
   Escape handling and focus restoration. Its native dialog example is preferable
   for production modals. A focused accessibility change should address the custom
   demo; this audit does not certify it as accessible.
5. The homepage render-pipeline tour stops under reduced motion but has no manual
   pause/step controls. Add controls so readers can inspect each state at their pace.
6. `packages/web-docs/components/BlogLayout.jsx` tests whether update and publication
   dates differ, rather than whether the update is later. A timestamp earlier than
   publication can show “Last updated”. Fix this in the package and release it;
   the website currently consumes the published package.
7. Native DOM `userEvent` limitations are verified against esdev 0.14 only. The
   warning states that version; recheck 0.15 before claiming the APIs are supported.
   JSX/TSX maps are supported, while MDX maps still point to generated JSX.
8. The shared `Tabs` component declares a tablist but its buttons/panels lack
   tab/tabpanel roles, selection state and arrow-key navigation. Its visual
   switching works, but the package needs a separate accessibility correction.

## Page coverage

Every route below was reviewed in source and loaded in Chromium. “No additional
content issue found” means no concrete correction emerged from this review, not
that every example or interaction was independently executed.

| Route | Review outcome |
| --- | --- |
| `/api` | No additional content issue found. |
| `/api/web-docs` | Corrected native plugin exports and build registration; documented search API. |
| `/api/web-form` | Standardized package installation command. |
| `/api/web-i18n` | No additional content issue found. |
| `/api/web-test` | No additional content issue found. |
| `/blog/how-signals-work` | Clarified signal invalidation versus dependent computation work. |
| `/blog/introducing-otf-web` | Qualified rendering and framework comparison claims. |
| `/blog/on-demand-dev-server` | Marked the retired development-server design as historical. |
| `/blog` | Removed stale scaffolder guidance. |
| `/docs/benchmarks` | Labeled measurements as historical and explained remeasurement blocker. |
| `/docs/cli` | Removed contributor commands and repeated installation details; creation starts interactively. |
| `/docs/configuration` | Clarified project scope and title; linked to docs settings instead of duplicating fields. |
| `/docs/core` | Added missing runtime APIs; corrected batch and i18n guidance. |
| `/docs/core-concepts/assets` | Corrected asset example path. |
| `/docs/core-concepts/components` | Clarified props and split examples into importable files. |
| `/docs/core-concepts/context` | Corrected component-file example. |
| `/docs/core-concepts/error-boundary` | Removed retired overlay behavior. |
| `/docs/core-concepts/imperative-api` | Replaced unsupported exposed getters with methods; split files. |
| `/docs/core-concepts/jsx` | Corrected member-component support; documented SSG spread limit; labeled demos. |
| `/docs/core-concepts/lifecycle` | Fixed hydration-sensitive clock example and hook guidance. |
| `/docs/core-concepts/portal` | No content edit; custom-modal accessibility follow-up recorded below. |
| `/docs/core-concepts/reactivity` | Clarified nested increment support and runtime identity. |
| `/docs/core-concepts/styling` | No additional content issue found. |
| `/docs/core-concepts/templating` | Qualified keyed-list reconciliation claims. |
| `/docs/data-fetching` | Fixed loader result shape; added client loader registration and safe resource example. |
| `/docs/deployment/build` | Added build dependencies removed from Installation; linked generated outputs to the SSG guide. |
| `/docs/deployment/fetch-handler` | Clarified fallback and loader wiring; added Worker-first and asset exclusion guidance. |
| `/docs/deployment/hydration` | Removed unsupported guarantees and retired overlay instructions. |
| `/docs/deployment` | Clarified app-owned server responsibilities. |
| `/docs/deployment/server` | Renamed Server Setup to distinguish the walkthrough from the API reference. |
| `/docs/deployment/static-generation` | Documented report/output hooks, CLI dependency and development SSG guard. |
| `/docs/getting-started/installation` | OS installation tabs; interactive create first; removed unrelated build, testing and contributor sections. |
| `/docs/getting-started/library-template` | Aligned native test example and tooling version. |
| `/docs/getting-started/project-structure` | Separated intended native layout from pending upstream templates; corrected discovery rules. |
| `/docs/macros` | Corrected $expose behavior and multi-file examples. |
| `/docs` | Replaced compile-time dependency tracking and automatic full-stack claims. |
| `/docs/routing/api-routes` | No additional content issue found. |
| `/docs/routing/cookies` | Fixed loader context argument and request availability. |
| `/docs/routing/dynamic-routes` | Corrected catch-all params to arrays. |
| `/docs/routing/metadata` | No additional content issue found. |
| `/docs/routing/middleware` | Clarified explicit server composition and asset bypass responsibility. |
| `/docs/routing/navigation` | No additional content issue found. |
| `/docs/routing/pages-and-layouts` | Removed automatic metadata injection claim. |
| `/docs/routing/route-guards` | Corrected initial-mount behavior, registration and redirect history behavior. |
| `/docs/server` | Corrected middleware composition and Node adapter import; renamed Server API. |
| `/docs/troubleshooting` | Replaced retired overlay instructions; corrected source-map limits and broken anchor. |
| `/packages` | No additional content issue found. |
| `/packages/web-docs/blog` | Documented explicit blog plugin registration and finish-hook output generation. |
| `/packages/web-docs/components` | Corrected package-manager example. |
| `/packages/web-docs/configuration` | Corrected sidebar precedence/order, explicit plugins, timestamps/edit links and search setup. |
| `/packages/web-docs/markdown` | Fixed repository/image links and duplicate h1 demo. |
| `/packages/web-docs` | Added native plugin/style setup and standardized install command. |
| `/packages/web-form/nested-state` | Labeled nested fields and tag controls. |
| `/packages/web-form` | Labeled live inputs and passenger controls; standardized install guidance. |
| `/packages/web-form/validation` | Labeled validation inputs and standardized package installation. |
| `/packages/web-i18n/formatting` | Replaced unsupported JSX helper rendering; verified locale-button interaction. |
| `/packages/web-i18n` | Fixed internal links and explicit i18n setup/loading guidance. |
| `/packages/web-i18n/routing` | Replaced retired config wiring with explicit setup and static locale imports. |
| `/packages/web-test` | No additional content issue found. |
| `/packages/web-test/queries` | No additional content issue found. |
| `/packages/web-test/setup` | Updated esdev minimum version. |
| `/packages/web-test/strategies` | Aligned native DOM interaction example. |
| `/packages/web-test/user-events` | Browser guidance retained; native DOM warning remains explicitly scoped to verified 0.14 behavior. |
| `/packages/web-test/writing-tests` | No additional content issue found. |
| `/` | Updated capability claims, setup CTA and benchmark context; fixed main landmark. |
| `404` | Reviewed generated HTML; corrected main landmark. |
