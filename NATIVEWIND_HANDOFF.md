# NativeWind v5 × react-native-css-nitro — handoff

For Dan Stepanov's v4→v5 compatibility audit. Everything below is verified
against the actual runtime, not aspirational. Neither effort claims "verified
NativeWind compatibility" until this document and your suite agree.

## What this repo is

`react-native-css@4.0.0` — the C++ port of upstream `nativewind/react-native-css`
(JS v3.x). TS compiler (canonical for the 4.0 line) + C++ Nitro Modules runtime.
Drop-in for the `react-native-css` package name: NativeWind v5's
metro/compiler/config surfaces keep working; the runtime underneath is native.

- **Repo:** `ronin-software/react-native-css-nitro`, branch `phase-0/test-harness`
  (never force-push). Everything in this doc is on that branch as of `6d90261`.
- **Quick consume:** `yarn add react-native-css@link:<this-repo>` + the pod
  autolinks (`pod 'CssNitro', :path => <repo>`). `corepack yarn build` before
  device builds — metro consumes `lib/` via the exports map.
- **Reference integration:** the nativewind repo's own example app runs on it
  (evidence `verification/v4-nativewind-v5.png`); our showcase app exercises
  the full feature matrix (`verification/v3-*.png`).

## Compatibility contract

- **Exports map:** `./components`, `./metro`, `./compiler`, `./jest`,
  `./style-collection`, plus the runtime API (`styled`, `useCssElement`,
  `vars`, `VariableContextProvider`, `useUnstableNativeVariable`,
  `useNativeCss`). Gotcha: every export value must start with `./` (an invalid
  entry silently disables the whole map) and `require`/`import` conditions must
  precede `default`.
- **Wire format:** `HybridStyleSheet {s, vr, vu, r}`; rules carry
  `s/d/v/pq/mq/cq/aq`; fn-tuples `["fn", name, ...args]`; marker tuples
  `[{}, kind, ...args]`. Compiler contract tests pin this:
  `src/__tests__/compiler/css-functions.test.ts`.
- **Test surface:** ported upstream native corpus runs against a JS double of
  the runtime (`src/jest/reference-registry.ts`) — your fixtures can run the
  same way without a native build: `setStyleRegistry(new ReferenceRegistry())`.

## Current state (measured, not claimed)

- **Jest:** 215 passed / 12 skipped / 1 todo (228). Skips are documented with
  `TODO:` in-file: transitions-related group animation, one box-shadow parser
  edge, currentcolor-in-box-shadow (needs JS PlatformColor interplay),
  transform-fns inside var(), and one dev-warning contract (container added
  post-mount). Upstream's native suite is the behavioral spec — every suite is
  ported.
- **C++ doctests:** 44/44 (`yarn test:native`).
- **Device e2e:** showcase + nativewind example verified on iPhone 17 Pro /
  iOS 26.5. Pixel + perf gates: `yarn verify:device`,
  `yarn bench:check` (see PORTING.md "Regression gates").

## Perf (the headline for the audit)

- Style-resolution core: **8.0× geometric mean** over the JS v3 runtime
  (specificity sort 7.1×, rule merge 31×, calc 20.6×, simple var 9×) — Node/V8
  vs C++; on-device Hermes is slower, so these are floors. Best-of-3 gated by
  `yarn bench:check`.
- **Shadow-tree direct write (default on):** style-only updates commit
  straight into the Fabric tree via `UIManager.updateShadowTree` — **0 React
  renders** per style change (JS v3: render-per-update, mandatory). Device
  measured: a group `:active` press costs 2 styled renders with the write
  disabled, 0 enabled; pixel-verified red-700 mid-hold. Opt out with
  `RN_CSS_SHADOW_WRITE=0`. Mechanism + the stale-props design are in
  PORTING.md; the interesting bug (unsigned ARGB saturating to INT32_MAX in a
  double→int cast) is documented there too.

## Findings in your taxonomy

- **Tailwind generation:** unchanged — v5's generation feeds our compiler
  untouched.
- **CSS compilation:** our compiler extends upstream's: dark-mode class
  selectors (`@cssInterop set darkMode class` / `@react-native { darkMode:
  dark }`) compile to media conditions; `data-*` selectors route to
  `AttributeQuery.d`; `textShadowOffset` emits nested `{width,height}`;
  `env(safe-area-inset-*)` → variables.
- **Runtime behavior:** group selectors + named containers resolve end-to-end
  (layout events → C++ container queries); attribute selectors evaluate
  against published props; vars/calc/filters/text-shadow/color-mix resolve in
  C++ including the Tailwind opacity-modifier pattern. React renders carry
  upstream-identical props (View is a plain RNView unless interactive —
  Pressable synthesis removed).
- **Component integration:** components surface re-exports are live; the four
  formerly-blocked suites (keywords/units/vars/variables) pass.
- **Packaging:** exports map + pod autolinking verified via link: portals in
  the nativewind example (see PORTING.md canary-pairing workarounds —
  polyfill ordering, `InitializeCore` import, reanimated removed from that
  example).

## What we'd like from your suite

1. Run your fixture apps against this branch (link: portal is the fastest
   swap) — especially transitions/animations, our largest documented gap.
2. Shadow-write default: keep on, or gate per-app? The re-assert mechanism
   commits after every React commit; we haven't measured it on list-heavy
   screens (virtualization interplay untested).
3. Any v4 behaviors your audit depends on that the corpus doesn't cover — the
   double makes them testable without a native build.

## Known gaps (honest list)

- Transitions/animations: group-animated + related suites skipped; C++ has no
  transition engine yet.
- `color-mix` of two runtime colors in non-sRGB spaces (compile-time inlining
  covers the static cases; the runtime transparent-fold path handles Tailwind
  opacity modifiers).
- Transform functions inside `var()` values.
- Shadow-write: JSI-boundary colors are pre-processed via the registered
  `processColor`; PlatformColor objects inside arrays (box-shadow lists) are
  not processed recursively.
