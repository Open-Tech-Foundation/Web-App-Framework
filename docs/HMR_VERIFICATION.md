# HMR verification and comparison

Checked on 2026-10-02 with esdev 0.15.0, Chromium 153.0.8010.52 and this checkout's
**local plugin, runtime and native compiler**. The new behavior requires releasing
all three together; it is not present in the previously published toolchain.

## Implemented behavior

esdev supplies the update channel, dependency propagation, accepted module
replacement and persistent module data. OTF's plugin now requests development CSR
output only for `ctx.hot` browser builds. Release, server and test compilation
retain their normal output.

The compiler emits stable component identities and state/props compatibility
metadata. A separate development runtime keeps the Custom Element registry entry
and dispatches its cached lifecycle callbacks to the latest implementation.
Before rebuilding each host, it disposes the old bindings, effects and lifecycle
hooks. Named `$state` slots and existing prop signals survive compatible edits.
Refs and derived values are recreated; derived values detach their old subscriptions.

The refresh pass visits existing ancestors first. Children recreated by an updated
ancestor mount once; slotted children are moved into the new view and retain their
host/state. Other children created by the edited view remount. Focus is restored
for an element with a stable id; state-backed input drafts survive. Uncontrolled
fields inside the rebuilt view reset.

Page/layout factories keep a stable development proxy. Updating an active factory
rebuilds the route views without navigation: no URL/history change, guard execution,
loader fetch or heading focus jump. Those route views and their child components
remount, so local state resets. Updating an inactive factory leaves the current
view alone and takes effect on the next client navigation.

Changed component identities/exports, prop declarations/defaults or state
names/kinds use the reload fallback. State initializer edits do not replace an
existing value. This checks declaration compatibility, not arbitrary changes to
state meaning or object shape. Modules exporting other helpers or using `$expose`
remain reload boundaries.

The landing page reports component HMR as **partial**, with the next-release
requirement and route-remount limit stated explicitly.

## Repeatable browser verification

Run `tsr test-e2e-hmr` (or build the compiler and run
`esdev scripts/verify-hmr.mjs`). The esdev script materializes local package files
and the freshly built compiler into an isolated fixture, starts esdev and Chromium,
edits source files, and checks browser behavior through CDP. It uses no Node script
or registry package. Set `CHROMIUM_BIN` if Chromium is not `/usr/bin/chromium`;
`HMR_VERBOSE=1` includes child process logs.

A new-document token distinguishes reloads from updates; scroll restoration alone
is not evidence of HMR. The fixture verifies:

| Change/check | Document reload? | Verified result |
| --- | --- | --- |
| Global CSS | No | Computed style changes while the document remains alive. |
| Two successive component edits | No | Same host, count, state-backed draft, focus, selection and scroll. |
| Effect/mount teardown | No | Old setup disposed once; subsequent writes have no duplicate effects. |
| Refs/derived values | No | Ref points to the new input; derived value reflects retained state. |
| Co-located parent/child components | No | Child mounts once per module update. |
| Slotted parent edit | No | Slotted child host and state survive; it does not remount. |
| Active page/layout edit | No | New content, unchanged URL/history and guard count; child state resets. |
| Inactive route edit | No | Active view/state stay intact; updated page renders on client navigation. |
| Genuine disconnect/remount | No document reload | Cleanup runs and local state initializes fresh. |
| Added state declaration | Yes | Incompatible shape reloads and initializes fresh state. |
| Introduced helper export | Yes | Unsafe module boundary reloads. |
| Changed observed props | Yes | Reload uses the new constructor/default. |

Plugin tests also verify source-map positions in hot output, release/server
exclusion and mixed-export boundaries. Runtime tests cover derived-value disposal
and cleanup failures. The ordinary router and lifecycle suites remain green.

Earlier baseline checks confirmed full reloads for JSX, stale views with a naive
`accept()` addition, and working explicit JavaScript acceptance/`hot.keep`.
OTF now consumes the [official esdev HMR API](https://esrun.opentechf.org/esdev/start/hmr/)
instead of adding a transport or bundler.

## Error recovery issue

A malformed OTF page produces the expected esdev build-error overlay. The previous
view, counter and input remain usable. Saving the repaired page then crashes the
installed esdev process in Rolldown's incremental cache:

```text
rolldown-1.2.3/src/types/scan_stage_cache.rs:79:28
called `Option::unwrap()` on a `None` value
```

Reproduced in the full edit sequence and again in a fresh dev session containing
only the break/fix check. The browser keeps the old page and error overlay because
the dev process has stopped. Restarting with valid source renders normally.

A separate **plain JavaScript fixture without the OTF plugin** recovers from its
syntax error and displays the fixed text. This narrows the problem to the
transform-error/incremental-build integration; it does not establish that every
esdev error-recovery path is broken. The panic occurs inside Rolldown, so the
upstream integration needs investigation with the OTF transform failure reproducer.

## Comparison

React was tested live on the **same esdev 0.15.0** using its generated refresh plugin,
React 19.3.0 and react-refresh 0.19.0. Editing its component heading kept the document,
counter value, draft input and focus. The other rows describe official documentation
or source, not locally executed competitor fixtures.

| Framework/tooling | Component update behavior | State limits |
| --- | --- | --- |
| OTF + local esdev plugin | Compatible component edits replace the view in place; pages/layouts refresh the active route. | Named state slots survive compatible component edits; route views and newly created child views remount. |
| React Fast Refresh | Compatible component edits update in place; verified on esdev here. | Function/hook state survives compatible edits; unsafe boundaries can remount/reload. [Official guide](https://nextjs.org/docs/architecture/fast-refresh). |
| Vue | Has component records and separate rerender/reload paths. | Template edits preserve instance state; script changes can recreate affected instances. [Guide](https://vue-loader.vuejs.org/guide/hot-reload.html), [current runtime](https://github.com/vuejs/core/blob/main/packages/runtime-core/src/hmr.ts). |
| Svelte | Compiler option and runtime wrapper support component HMR. | The current wrapper destroys the previous inner effect and invokes the new component; it does not justify a blanket promise of local-state retention. [Compiler docs](https://svelte.dev/docs/svelte/svelte-compiler#CompileOptions), [runtime source](https://github.com/sveltejs/svelte/blob/main/packages/svelte/src/internal/client/dev/hmr.js). |
| Solid | Refresh plugin replaces components and handles render cleanup. | State preservation is explicitly partial. [Official refresh package](https://github.com/solidjs/solid-refresh). |
| Angular CLI | Automatic template and stylesheet HMR. | General JavaScript HMR is not supported by this build pipeline. [Official build-system guide](https://angular.dev/tools/cli/build-system-migration#hot-module-replacement). |

OTF now has a compiler/runtime refresh integration on the same esdev transport.
Its limits remain narrower than full route-tree state retention: route edits remount
the route, and unsupported boundaries reload. These checks do not rank rebuild speed.

## Remaining work

1. Fix/retest the upstream transform-error recovery panic described above.
2. Release `@opentf/web`, `@opentf/esdev-plugin-web` and rebuilt
   `@opentf/web-compiler` platform archives together. The binary remains `otfwc`;
   no second executable is needed. Update isolated site/starter dependencies after release.
3. Optional future improvements: preserve route-tree state across page/layout edits,
   retain additional unaffected children during view replacement, and support more
   mixed-export/imperative boundaries. These are not implemented by this refresh pass.

The old investigation logs remain under `/tmp/otfw-hmr-local`, `/tmp/react-hmr`
and `/tmp/esdev-hmr-recovery-plain`; temporary files can disappear. The permanent
browser script and package tests are the reproducible evidence for the new behavior.
