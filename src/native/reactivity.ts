/**
 * Reactivity shims mirroring upstream's `native/reactivity` surface, backed
 * by the registry seam (reference registry in jest, C++ registry on device).
 *
 * Upstream exposes observables for dimensions; here the registry owns that
 * state for style resolution, and these adapters stay in sync for callers.
 */
import { Dimensions } from "react-native";

import { getStyleRegistry } from "../specs/StyleRegistry";

export const VAR_SYMBOL = Symbol.for("react-native-css.var");

let current = { ...Dimensions.get("window") };
const subscribers = new Set<() => void>();

function commit(next: Partial<typeof current>) {
  current = { ...current, ...next };
  const registry = getStyleRegistry() as {
    setDimensions?: (dimensions: typeof current) => void;
  };
  registry.setDimensions?.(current);
  for (const subscriber of subscribers) {
    subscriber();
  }
}

export const dimensions = {
  get() {
    return current;
  },
  set(next: Partial<typeof current>) {
    commit(next);
  },
};

export const vw = {
  get() {
    return current.width;
  },
};

export const vh = {
  get() {
    return current.height;
  },
};

export function subscribeStyles(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
