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

## Next steps

1. Port remaining upstream suites: animations, transitions, calc, box-shadow,
   className-with-style, rightIsInline, filters (blocked on features), the
   .ios-only files
2. Port the styled() HOC to un-skip the remaining specificity tests
3. Wire ContainerContext::setScope — named containers AND group selectors
   compile to container queries but the scope hierarchy is never populated,
   so both fail on device too
4. On-device e2e (Maestro) for shadow-tree writes and transitions

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
