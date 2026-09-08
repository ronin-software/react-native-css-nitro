# Porting react-native-css → C++ (react-native-css 4.0)

Notes for completing the port of `nativewind/react-native-css` (JS runtime) to
this repo's C++ runtime. Companion to the README progress checklist.

## Direction

- This repo's compiler + `HybridStyleSheet` format is **canonical** for the 4.0
  line. The C++ `StyleRegistry` consumes that format directly; the upstream JS
  compiler's `StyleDescriptor` format is the 3.x JS runtime's internal
  instruction set and is not the port target.
- Upstream (3.x) is effectively frozen; its post-fork fixes are ported here as
  they are found (e.g. the parseColor NaN coercion, 2026-07).

## Verification strategy

The behavioral spec is upstream's test suite (`src/__tests__/native/`, 220
tests). Verification is layered:

1. **Compiler tests (jest)** — CSS → `HybridStyleSheet` JSON. Ported from
   upstream `src/__tests__/compiler/` as needed.
2. **Native core tests (doctest, `yarn test:native`)** — the RN-free C++ core
   (StyleResolver, StyleFunction, VariableContext, Rules, reactive system)
   compiled and run off-device with cmake + doctest. This is the primary
   scoreboard for runtime semantics.
3. **JS glue tests (jest)** — components/hooks with the registry stubbed at the
   `StyleRegistry` interface.
4. **Device e2e** — real C++ via NitroModules, shadow-tree writes, transitions.

## Findings so far

- `AnyMap::setArray/setObject/setAny` use `emplace` — they silently no-op when
  the key exists. `StyleResolver::applyStyleMapping` was rewritten to
  aggregate transform props locally and write once (regression-tested in
  `cpp/tests/style_resolver_tests.cpp`).
- CSS math functions are implemented end-to-end: the compiler emits
  `"fn"`-tuples for calc/min/max/clamp/min/mod/rem/round/sign/abs/hypot
  (including a token-level path for calcs lightningcss can't type, i.e. those
  containing `var()`), and the C++ `StyleFunction` resolves them with
  upstream's percent-mixing semantics. Covered by compiler contract tests
  (`src/__tests__/compiler/css-functions.test.ts`) and doctests.
  - Compiler bugs fixed along the way: calc tuples were flattened by spread
    (`["fn", "calc", ...args]`), calc was double-wrapped (both `calcArguments`
    and `length()` wrapped), and calc-with-var declarations were dropped
    entirely.
  - Remaining gap: exotic units (in/cm/pt/ch/…, container query units) are
    dropped at compile time with upstream parity. Safe-area units (env()) are
    a separate checklist item.
- Platform/display functions resolved in C++: hairlineWidth, pixelScale,
  fontScale, getPixelSizeForLayoutSize, roundToNearestPixel (env scale/fontScale
  observables). The compiler now also emits zero-arg fns (fontScale() was
  dropped). `platformSelect`/`pixelScaleSelect` are dead code upstream (a
  theme-helper string with no runtime resolver) and remain unsupported.
- Root variables flow: `addStyleSheet` now registers the stylesheet's `vr`
  (root vars) and `r` (rem base) fields; variables use the
  `[{v: value, m?: media}]` encoding, and the JS layer seeds `__rn-css-rem`
  with the upstream default (14).
- The compiler wraps single function values in a one-element list
  (`[["fn", ...]]`); `StyleResolver::resolveStyle` unwraps before resolving.
- The native test target must stay free of `react/renderer` and folly — only
  `ShadowTreeUpdateManager` pulls those in, and it is excluded from the
  doctest binary (exercised on-device instead).

## Jest layer status

The `StyleRegistry` seam exists (`getStyleRegistry`/`setStyleRegistry`) and
`src/jest` provides upstream-compatible `registerCSS`/`testID` helpers backed
by a JS reference registry (`src/jest/reference-registry.ts`) mirroring
cpp/StyledComputedFactory.cpp. Ported upstream test files so far:
specificity, pseudo-classes, style-updating (16 passing, 4 skipped pending
the styled() HOC). Bugs found by porting:
- compiler dropped specificity/pseudo/attribute data from parsed selectors
  (`createRule` never applied them)
- compiler routed important declarations through the normal path
- compiler dropped zero-arg functions (fontScale(), pixelScale())
- pseudo-class handlers recursed into themselves (captured the wrapper as the
  "original" callback)

## Device e2e

The example app (Release build, iPhone 17 Pro / iOS 26.5) is verified
end-to-end via Maestro (`example/.e2e/verify-styles.yaml`) and agent-device:
compile-time colors, calc, CSS variables, platform media queries, box-shadow,
transform, Nitro C++ interop, and the full :active press/release lifecycle.

Findings from device verification:
- `uiManager.updateShadowTree` (the shadow-tree direct-write path) is broken
  under RN 0.82 Fabric — colors render incorrectly and nodes disappear. The
  C++ computed now always re-renders via React instead (correctness over the
  perf win until ShadowTreeUpdateManager is fixed).
- Nitrogen generated TRUE/FALSE enum names colliding with ObjC macros —
  attribute-query wire values renamed to present/absent.

## NativeWind integration map

NativeWind v5 preview (nativewind@5.0.0-preview.4, branch `v5`) peer-depends
on `react-native-css: ^3.0.1` — the JS runtime, not this port. Its own source
is thin: it re-exports the runtime API. NativeWind consumes:

- root: `styled`, `useCssElement`, `useUnstableNativeVariable`, `vars`,
  `VariableContextProvider`
- `react-native-css/components` (className-aware View/Text/…)
- `react-native-css/metro` (withReactNativeCSS), `./babel`,
  `./style-collection`, `./compiler`, `./jest`

To run NativeWind v5 against this C++ runtime we must implement that surface
as an adapter — it is exactly the "3rd party hook" checklist item. The parked
blocked test suites (vars/variables/selectors/units/keywords) are that
surface's tests, and the published react-native-css 3.0.0-preview.1 package
is the reference implementation to port.

Baseline e2e (NativeWind v5 preview on the upstream JS runtime) is ready to
run: the v5 branch example app installs cleanly (expo canary, RN 0.80.1) and
can be verified with the same Maestro/agent-device harness.

## Resolved: darkMode-class selectors

The `selectors` suite (3 tests) requires @cssInterop darkMode-class
compilation — upstream v5 has this code COMMENTED OUT in
compiler/selectors.ts and ships all three tests as test.skip. Our skips are
exact parity, not missing work. Revisit if/when upstream implements it.

## In progress: group propagation

Container scope wiring is DONE (C++ + double): named containers register via
getDeclarations (rule.c + group className convention), layouts flow through
updateComponentLayout → ContainerContext, and named-container queries resolve
(container-queries named test passes with real layout events).

Remaining: group PROPAGATION — the parent registers the "group/item" scope,
but the memoized child doesn't re-run registerComponent when only its
inherited containerScope changes (React context change alone doesn't bump the
useMemo deps). Needs the child to subscribe to container-scope changes
(re-render on scope change) — 3 grouping tests skipped on this.

## Milestone: NativeWind v5 example app runs on the C++ runtime

Verified e2e on the iPhone 17 Pro simulator (Release build): the nativewind
repo's own example app (Expo 54 canary / RN 0.80.1) renders through the full
metro plugin -> compiler -> CssNitro pod pipeline. Centering classes apply,
tabular-nums applies, and var-based colors (text-green-500 -> vr root var)
resolve on device.

Integration setup (nativewind repo, local): react-native-css symlinked to the
nitro repo; example links CssNitro + react-native-nitro-modules via yarn
portals for autolinking/codegen; Pods added by expo autolinking. Example-side
workarounds for the canary pairing: FormData stub polyfill (Hermes RN 0.80),
InitializeCore import in index.js (old-arch core setup), reanimated/worklets
blocked (their init crashes; our components no longer hard-require reanimated),
fmt bumped to 11.2.0 (Xcode 26.5 consteval regression), nativewind theme
plugin import disabled in example global.css (plugin build crashes tailwind
silently — see nativewind#compatibility-audit).

Bugs found & fixed on the way (test-first, doctest):
1. View/Text hard-required react-native-reanimated — upstream peer-dep only;
   removed (AnimatedView/AnimatedText = plain components)
2. metro resolver isFromThisModule checked dist/src but we ship lib/ — our own
   components' react-native imports redirected to themselves (cycle). Now
   excludes the whole package root.
3. C++ VariableContext::getVariable never fell back to the root scope for
   scopes outside the context chain (first resolve pass found nothing AND
   never subscribed to the root observable)
4. C++ top-level variable unwrap didn't handle the compiler's one-element
   value lists (vr: {green: [{v: ["#00c758"]}]}) — color stayed an array
5. StyledComputedFactory lambda captured inlineVariables without listing it;
   HybridStyleRegistry used inlineVarsObs before declaration (never compiled
   since the vars() feature landed — stale DerivedData masked both)
6. package.json exports: missing "./components" subpath, missing types
   condition, invalid non-"./" target silently disabled the whole exports map
7. useUnstableNativeVariable added to runtime (snapshot reads)
8. podspec excluded cpp/bench from app builds

## Group selectors: DONE (this session)

All three grouping tests pass. The mechanism, end to end:

1. The compiler emits group rules as container queries on the child:
   `.group/item:active .child` → child rule cq `[{p: {a: true}, n: "group/item"}]`;
   `.my-a.my-b .child` → cq `[{n: "my-b"}]` + aq (id) matching the container's
   classes.
2. The registry indexes every class referenced as a cq target
   (referencedContainers) — a component carrying a referenced class is a group
   container even with no rules of its own (C++ + double).
3. Group pseudo (cq.p) evaluates against the CONTAINER's press/hover/focus
   state (C++ testContainerQuery → testPseudoClasses(resolvedScope) — already
   correct; double now implements it).
4. Group attribute queries evaluate against the container's published props:
   useStyledProps publishes props via updateComponentAttributes (new spec
   method, C++ stores observables; the factory's evaluator reads through get
   so the child's effect subscribes to container attribute changes).
5. View/Text wire press/hover/focus handlers unconditionally — a component
   with no pseudo rules of its own can still be an active group container.

Dark-mode class support design (next session): `:is(.dark *)` and
`:root[class~="dark"]` are the same machinery — colorScheme.set("dark") in
class mode registers the dark class on the root container scope; children's
group rules resolve through the existing scope chain. The compiler's darkMode
directive (`@cssInterop set darkMode class dark`) needs to map
`:is(.dark *)` selectors to the descendant cq/aq form (upstream's
implementation is commented out — ours completes the design).

Also fixed: react-native-nitro-modules moved from peerDependencies to
dependencies — monorepo-config's blockList excluded peers' node_modules paths,
breaking package resolution from the example app.

## Next steps

1. Port remaining upstream suites: animations, transitions, calc, box-shadow,
   className-with-style, rightIsInline, filters (blocked on features), the
   .ios-only files
2. Port the styled() HOC to un-skip the remaining specificity tests
3. Wire ContainerContext::setScope — named containers AND group selectors
   compile to container queries but the scope hierarchy is never populated,
   so both fail on device too
4. On-device e2e (Maestro) for shadow-tree writes and transitions

## In progress: className-with-style + rightIsInline (68 tests)

The NativeWind adapter surface (styled/useCssElement/useNativeCss/vars/
VariableContextProvider) is implemented. The two big suites run but 37 tests
fail on style-merge semantics: the exact contract for className-layer vs
inline-layer preservation (flat merge vs array layering on conflicts,
multi-target FlatList/ScrollView mappings, consumed className sources) needs
to be derived from the remaining failures. 150 of 205 tests in those suites
already pass.

## Score (vs upstream's 220 native tests)

- 93 passing, 21 skipped with documented blockers, of 115 ported tests
  (17 of 28 upstream native files ported; 5 suites parked in
  src/__tests__/blocked/ pending unported APIs: styled() HOC, useNativeCss,
  VariableContextProvider)
- New features this round: box-shadow (compile-time + runtime var pattern
  incl. inset/multi/transparent filtering), @property defaults interplay,
  em via __rn-css-em font-size variable, selectorPrefix type exemption
- Remaining checklist feature work surfaced by tests: container/group scope
  hierarchy (setScope unwired), transform functions in var() values,
  safe-area env units, filters, styled() HOC, useNativeCss hook
