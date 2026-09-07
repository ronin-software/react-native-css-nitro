# Blocked test files

Ported from upstream but blocked on APIs that are not implemented yet:

- `keywords`, `units` — need `useNativeCss` (the internal hook API)
- `vars`, `variables`, `selectors` — need `styled()` HOC and
  `VariableContextProvider` (the "3rd party hook" / variable-scope APIs)

Move these back to `src/__tests__/native/` as the APIs land.
