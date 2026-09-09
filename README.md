# react-native-css-nitro

`react-native-css` ported to C++ (Nitro Modules) — the 4.0.0 line of the
CSS engine behind Nativewind v5. Fast-forward of upstream
[nativewind/react-native-css](https://github.com/nativewind/react-native-css)
(v3.x, JS runtime): the TypeScript compiler stays, the runtime moves into
C++, and the test corpus, gates, and benchmarks travel with it.

## Status

Verified, not yet published. The full upstream native test corpus is
ported and passing, device behavior is regression-gated, and the engine is
the candidate for `react-native-css@4.0.0`.

| Layer | Result |
| :--- | :--- |
| Ported upstream native suites (jest) | 223 passed, 12 skipped, 1 todo |
| C++ doctests (`yarn test:native`) | 44/44 |
| Device pixel + perf gate (`yarn verify:device`) | green |
| Compiler contract tests | green |

Performance vs the 3.x JS runtime (Node/V8; on-device Hermes is slower, so
these are floors):

| Workload | Speedup |
| :--- | :--- |
| Specificity sort (200 rules) | 7.1× |
| Merge 15 rules | 31× |
| calc() | 20.6× |
| Simple var() | 9.0× |
| **Composite (real-world mix)** | **2.2×** |
| **Geometric mean** | **8.0×** |

Style-only updates additionally commit directly into the Fabric shadow
tree — **0 React renders** per style change (see Architecture). Verified
compatibility with Nativewind v5's example app:
`verification/v4-nativewind-v5.png`.

## Architecture

The TypeScript compiler emits a wire format (`["fn", name, ...args]`
tuples, marker tuples, rule objects); the C++ runtime resolves it —
specificity, cascade, variables, functions, conditions — inside Nitro
hybrid objects, and writes resulting styles directly into the Fabric
shadow tree via `UIManager.updateShadowTree`.

Style-only updates therefore cost **no React render pass**. The fallback
React-rerender path remains available (`RN_CSS_SHADOW_WRITE=0`); after
every React commit the runtime re-asserts computed styles so stale
JS-cached props are corrected.

NativeWind v5 consumes the public API surface: `styled`, `useCssElement`,
`vars`, `VariableContextProvider`, `useUnstableNativeVariable`,
`useNativeCss`, plus `./components`, `./metro`, `./compiler`, `./jest`.

## Features

- [x] Dynamic styles — shadow tree + JS rerender
- [x] Style hot reload — shadow tree + JS rerender
- [x] Multiple style rules, specificity sorting
- [x] Pseudo classes, attribute selectors (incl. `data-*`, `aria-*`),
      `:disabled`/`:empty`
- [x] Media queries, container (named/media) queries, group selectors
- [x] Dark mode class selectors (`@cssInterop set darkMode class`)
- [x] Dynamic variables, inline variables, global variables w/ media queries
- [x] CSS math functions (calc, min, max, clamp, round, mod, rem, hypot, abs, sign)
- [x] Transitions, transforms (incl. percent scale)
- [x] box-shadow, text-shadow, filters (drop-shadow w/ runtime vars)
- [x] Safe area units (`env(safe-area-inset-*)` via `SafeAreaProvider`)
- [x] Em, rem, `currentColor`, color-mix, platform colors
- [x] Important styles / important props
- [x] Shorthand runtime styles (textShadow, dropShadow, colorMix)
- [x] Component wrappers: View, Text, TextInput, ImageBackground,
      FlatList, ScrollView, SafeAreaProvider, Pressable pass-through
- [x] Web
- [ ] Animations (keyframes resolve; no transition engine yet)
- [ ] CSS platform functions (`platformSelect` is dead upstream; others resolved)
- [ ] 3rd party hook (`nativeStyleToProp` etc)

## Install

Not yet published. For fixture/app iteration, pin the branch:

```sh
yarn add react-native-css@github:ronin-software/react-native-css-nitro#main
```

iOS requires the pod (autolinked by Expo, or manual):

```sh
pod 'CssNitro', :path => './node_modules/react-native-css'
```

Nativewind v5 setup is unchanged — the engine swaps in underneath the
existing `nativewind` package. See `NATIVEWIND_HANDOFF.md` for the full
integration contract and known gaps.

## Commands

```sh
corepack yarn install          # deps
corepack yarn test             # jest: ported upstream corpus + glue + compiler
corepack yarn test:native      # C++ doctest suite + build
corepack yarn typecheck        # tsc
corepack yarn lint             # eslint
corepack yarn bench            # cpp + js runtime benchmarks
corepack yarn bench:check      # perf regression gate (baseline × 0.7)
corepack yarn verify:device    # device pixel + perf regression gate
corepack yarn nitrogen         # regenerate Nitro specs (after editing *.nitro.ts)
```

Device gates require the example app built + installed on the booted
simulator (iPhone 17 Pro / iOS 26.5 is the recorded baseline).

## Verification

Four layers, all green — "done" means the lowest layer that can falsify it:

1. **C++ doctests** — runtime semantics of the RN-free core (44 cases)
2. **Ported upstream corpus** — behavior-level tests against a JS double of
   the C++ runtime (`src/jest/reference-registry.ts`); fixtures run on CI
   without a native build via `setStyleRegistry(new ReferenceRegistry())`
3. **Compiler contract tests** — pin the fn-tuple wire format between
   compiler and runtime
4. **Device e2e** — showcase app on simulator; pixel gate + 0-render
   shadow-write assertion (`example/.e2e/`)

Engine compatibility with the Nativewind v5 stack is being verified
independently in a private compatibility-audit repository (dispositions of
upstream v5 findings mirrored in `NATIVEWIND_HANDOFF.md`).
