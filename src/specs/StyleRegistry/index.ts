import { Dimensions, processColor } from "react-native";

import type {
  HybridStyleRegistry,
  JSStyleRegistry,
} from "./HybridStyleRegistry.nitro";

export type * from "./HybridStyleRegistry.nitro";

/**
 * The style registry API. Backed by the native C++ hybrid object in the app;
 * replaceable in tests via `setStyleRegistry`.
 */
export type StyleRegistryApi = Omit<HybridStyleRegistry, keyof JSStyleRegistry> &
  JSStyleRegistry;

let nativeInstance: StyleRegistryApi | undefined;
let override: StyleRegistryApi | undefined;

function createNativeRegistry(): StyleRegistryApi {
  // Lazy require: importing react-native-nitro-modules at module scope would
  // crash non-native environments (jest) at load time
  const { NitroModules } =
    require("react-native-nitro-modules") as typeof import("react-native-nitro-modules");

  const registry = NitroModules.createHybridObject<
    Omit<HybridStyleRegistry, keyof JSStyleRegistry> & JSStyleRegistry
  >("HybridStyleRegistry");

  const { width, height, scale, fontScale } = Dimensions.get("window");
  registry.setWindowDimensions(width, height, scale, fontScale);
  Dimensions.addEventListener("change", ({ window }) => {
    registry.setWindowDimensions(
      window.width,
      window.height,
      window.scale,
      window.fontScale,
    );
  });

  registry.registerExternalMethods({
    processColor,
  });

  return registry;
}

/**
 * The active style registry. Lazily creates the native hybrid object on
 * first access so importing this module never requires a native runtime.
 */
export function getStyleRegistry(): StyleRegistryApi {
  if (override) {
    return override;
  }
  return (nativeInstance ??= createNativeRegistry());
}

/**
 * Test seam: replace the registry with a JS implementation. Pass undefined
 * to restore the native registry.
 */
export function setStyleRegistry(registry: StyleRegistryApi | undefined): void {
  override = registry;
}
