# AGENTS.md — react-native-css-nitro

Authoritative instructions for any agent working in this repository.

## What this repo is

The C++ port of `react-native-css` (upstream: `nativewind/react-native-css`,
JS runtime, v3.x). Intended to become `react-native-css@4.0.0`. The compiler
stays TypeScript (this repo has its own, canonical for the 4.0 line); the
runtime is C++ via Nitro Modules. NativeWind v5 preview consumes the runtime
API surface — see "NativeWind contract" below.

Branch: `v4` is the active integration branch. Do not force-push.

## Commands

```sh
corepack yarn install          # deps
corepack yarn test             # jest: ported upstream corpus + glue + compiler
corepack yarn test:native      # C++ doctest suite (38 cases) + build
corepack yarn typecheck        # tsc
corepack yarn lint             # eslint (pre-existing failures in example/ are known)
corepack yarn bench            # cpp + js runtime benchmarks
corepack yarn nitrogen         # regenerate Nitro specs (run after editing *.nitro.ts)
```

Device e2e (iPhone 17 Pro / iOS 26.5 simulator):

```sh
cd example/ios && pod install
xcodebuild -workspace CssNitroExample.xcworkspace -scheme CssNitroExample \
  -configuration Release -destination 'id=A00E2E3A-1453-4BFE-86DB-9F83CC452925' \
  -derivedDataPath build build
maestro test example/.e2e/verify-styles.yaml
```

## The four verification layers

Every feature claim must be backed by at least one; "done" means green at the
lowest layer that can falsify it:

1. **C++ doctests** (`cpp/tests/`, `yarn test:native`) — runtime semantics of
   the RN-free core. The primary scoreboard for the port.
2. **Jest corpus** (`src/__tests__/native/`) — behavior-level tests ported from
   upstream's native suite, running against the JS glue + reference registry.
3. **Compiler contract tests** (`src/__tests__/compiler/css-functions.test.ts`
   and friends) — pin the `["fn", name, ...args]` tuple grammar between
   compiler and runtime. If these change, the C++ resolvers must change too.
4. **On-device e2e** (Maestro + agent-device) — shadow-tree integration,
   transitions, anything the layers above structurally cannot see.

## Acceptance criteria

- **Test-first.** A feature is not implemented until a test that fails without
  it exists. Bug fixes require a regression test that reproduces the bug.
- **No silent skips.** `test.skip`/blocked suites must carry a `TODO:` comment
  naming the blocker, and be listed in PORTING.md. Skipped ≠ done.
- **Wire-format changes are contract changes.** Anything altering the
  `HybridStyleSheet`/`HybridStyleRule` shape or fn-tuple grammar requires:
  updated compiler contract tests + updated C++ resolvers + PORTING.md note.
- **Spec edits require `yarn nitrogen`** and green `yarn test:native` after.
- **Upstream parity claims** must reference the ported upstream test file that
  proves them. The upstream suite (`nativewind/react-native-css`,
  `src/__tests__/native/`, ~220 tests) is the behavioral spec.
- **Published-artifact pinning.** When verifying upstream behavior, test the
  published npm tarball, not a working-tree checkout.
- **Oracle checks.** Periodically inject a deliberate failure and confirm the
  suites catch it. A suite that can't fail is not verification.

## Known blockers (do not re-derive, do not silently work around)

- `ContainerContext::setScope` is never called — named containers and group
  selectors (`cq: [{n: "..."}]`) cannot resolve anywhere yet. Upstream design
  seam; needs a design decision, not a patch.
- Shadow-tree direct writes (`uiManager.updateShadowTree`) are broken under
  RN 0.82 Fabric — computed styles always re-render via React instead
  (see `cpp/StyledComputedFactory.cpp`). Revisit ShadowTreeUpdateManager
  before claiming the perf path works.
- `styled()`, `useNativeCss`, `VariableContextProvider`, `useCssElement`,
  FlatList/ScrollView wrappers — the NativeWind-facing surface, unimplemented.
  Parked suites in `src/__tests__/blocked/` are that surface's tests.
- Filters, safe-area (`env()`), `platformSelect` (dead upstream too).

## House rules

- `trash` > `rm`. Never run destructive commands without asking.
- This repo's C++ core must stay free of `react/renderer` and folly — only
  `ShadowTreeUpdateManager` may touch those, and it stays out of the doctest
  binary.
- `example/` lint errors are pre-existing; don't fix drive-by.
- `/tmp` is not a workspace (macOS purges it). Persistent dirs only.
- Prefer `npx jest --watchman=false` locally (watchman hangs in this repo).

## NativeWind contract & collaboration

NativeWind v5 preview re-exports this runtime's API: `styled`, `useCssElement`,
`useUnstableNativeVariable`, `vars`, `VariableContextProvider`,
`./components`, `./metro`, `./style-collection`, `./compiler`, `./jest`.
Implementing that surface is the remaining major workstream; the parked
blocked suites are its tests.

A parallel effort (Dan Stepanov) runs a NativeWind v4-vs-v5 compatibility
audit with behavioral catalog + fixture apps. Findings are exchanged in their
taxonomy: Tailwind generation / CSS compilation / runtime behavior / component
integration / packaging. Neither effort claims "verified NativeWind
compatibility" until the other's suite agrees. See `PORTING.md` for the full map.
