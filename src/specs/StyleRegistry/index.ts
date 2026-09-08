import { Appearance, Dimensions, Platform, processColor } from "react-native";

import type { AnyMap } from "react-native-nitro-modules";

import type {
  HybridStyleRegistry,
  JSStyleRegistry,
} from "./HybridStyleRegistry.nitro";

export type * from "./HybridStyleRegistry.nitro";

/**
 * The style registry API. Backed by the native C++ hybrid object in the app;
 * replaceable in tests via `setStyleRegistry`.
 */
export type StyleRegistryApi = Omit<
  HybridStyleRegistry,
  keyof JSStyleRegistry
> &
  JSStyleRegistry;

let nativeInstance: StyleRegistryApi | undefined;
let override: StyleRegistryApi | undefined;

function createNativeRegistry(): StyleRegistryApi {
  // Lazy require: importing react-native-nitro-modules at module scope would
  // crash non-native environments (jest) at load time
  const { NitroModules } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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

  // Seed the default text/current color (upstream native-internal/root.ts):
  // currentcolor resolves to the platform label color before any author color
  if (
    Platform.OS === "ios" ||
    Platform.OS === "android" ||
    Platform.OS === "macos"
  ) {
    const { PlatformColor } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react-native") as typeof import("react-native");
    const label =
      Platform.OS === "ios" || Platform.OS === "macos"
        ? PlatformColor("label", "labelColor")
        : PlatformColor("?attr/textColorPrimary", "SystemBaseHighColor");
    registry.setRootVariables({
      // PlatformColor crosses the JSI boundary as a plain color object
      "__rn-css-color": [{ v: [label] }],
    } as unknown as AnyMap);
  }

  return registry;
}

const PLATFORMS: Partial<Record<string, string>> = {
  ios: "ios",
  android: "android",
  macos: "macos",
  windows: "windows",
  web: "web",
};

/**
 * Push the device platform and color scheme into the registry so platform
 * and prefers-color-scheme media queries resolve reactively.
 */
export function initializeEnvironment(registry: StyleRegistryApi): void {
  const os = Platform.OS;
  registry.setPlatform(PLATFORMS[os] ?? os);
  const scheme = Appearance.getColorScheme() as string | null;
  registry.setColorScheme(scheme ?? "");
  Appearance.addChangeListener((event) => {
    registry.setColorScheme(event.colorScheme ?? "");
  });
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
