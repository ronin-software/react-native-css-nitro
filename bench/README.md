# Runtime benchmarks

Measures the style-resolution core of both implementations on identical CSS
workloads (specificity sort, declaration merge+resolve, var() chains,
calc(), and a composite):

- `yarn bench:cpp` — this repo's C++ core (Release build, same sources as
  the doctest suite), via `cpp/bench/bench.cpp`
- `yarn bench:js` — the upstream `react-native-css` v3 runtime
  (calculateProps, resolveValue, specificityCompareFn, their compiler
  output) running in Node via jest

Methodology notes:
- Each side resolves the *same values* through its own real pipeline and
  data format (C++ fn-tuples vs JS StyleDescriptors).
- JS runs in Node (V8). On device it runs Hermes, which is slower — so
  these speedups are a *floor* for the on-device delta.
- The C++ side measures the style-resolution core; the shadow-tree
  direct-write path (default on, `RN_CSS_SHADOW_WRITE=0` to opt out)
  eliminates the React render pass entirely on device — see PORTING.md.
  Device measurement: a group press costs 2 styled React renders in
  rerender mode, 0 in shadow mode.
