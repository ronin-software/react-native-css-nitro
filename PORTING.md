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
- `StyleFunction::resolveStyleFn` only implements `var()`. The compiler already
  emits `["fn", "min", ...]`-style tuples, so CSS functions (min/max/calc/…)
  fail silently at runtime. Tracked as the "CSS functions" checklist item;
  documented as a skipped doctest.
- The native test target must stay free of `react/renderer` and folly — only
  `ShadowTreeUpdateManager` pulls those in, and it is excluded from the
  doctest binary (exercised on-device instead).

## Next steps

1. Add a `StyleRegistry` seam (lazy creation + test override) and a jest
   harness (`registerCSS`) so upstream's native test files can be ported
   wholesale as the JS-glue layer spec.
2. Port upstream's native test files; sort into: green today, fixable via C++
   core, blocked on checklist items (CSS functions, filters, safe-area, …).
3. Implement gaps test-first, with matching doctests at the registry boundary.
