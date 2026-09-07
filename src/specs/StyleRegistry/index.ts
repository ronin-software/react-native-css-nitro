import { Dimensions, processColor } from "react-native";

import { NitroModules } from "react-native-nitro-modules";

import type {
  HybridStyleRegistry,
  JSStyleRegistry,
} from "./HybridStyleRegistry.nitro";

export type * from "./HybridStyleRegistry.nitro";

export const StyleRegistry = NitroModules.createHybridObject<
  Omit<HybridStyleRegistry, keyof JSStyleRegistry> & JSStyleRegistry
>("HybridStyleRegistry");

const { width, height, scale, fontScale } = Dimensions.get("window");
StyleRegistry.setWindowDimensions(width, height, scale, fontScale);

// Default rem base, matching upstream's root.ts. Stylesheets can override
// via the `r` field. Variables are [{v: value, m?: media}] arrays.
StyleRegistry.setRootVariables({ "__rn-css-rem": [{ v: 14 }] });
Dimensions.addEventListener("change", ({ window }) => {
  StyleRegistry.setWindowDimensions(
    window.width,
    window.height,
    window.scale,
    window.fontScale,
  );
});

StyleRegistry.registerExternalMethods({
  processColor,
});
