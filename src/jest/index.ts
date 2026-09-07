/**
 * Jest harness for react-native-css-nitro, mirroring upstream's
 * `react-native-css/jest` helper so upstream test files port with minimal
 * changes.
 *
 * `registerCSS` compiles CSS and injects it into a JS reference registry
 * (see ./reference-registry.ts). The reference implements the C++ pipeline's
 * semantics in jest; the C++ registry itself is verified by
 * `yarn test:native` and on-device e2e.
 */
import { compile } from "../compiler";
import { ReferenceRegistry } from "./reference-registry";
import { setStyleRegistry } from "../specs/StyleRegistry";

export const testID = "react-native-css";

export const registry = new ReferenceRegistry();

setStyleRegistry(registry as never);

/**
 * Compile CSS and inject the result into the test registry.
 */
export function registerCSS(css: string): ReturnType<typeof compile> {
  return injectCompiled(compile(css));
}

/**
 * Inject an already-compiled stylesheet (for hand-written rule fixtures).
 */
export function injectCompiled(compiled: ReturnType<typeof compile>) {
  registry.addStyleSheet(compiled.stylesheet());
  return compiled;
}
