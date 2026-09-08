import { Appearance, type ColorSchemeName } from "react-native";

import { getStyleRegistry } from "../specs/StyleRegistry";

/** Upstream-parity colorScheme getter/setter backed by the registry */
export const colorScheme = {
  get(): ColorSchemeName | null {
    return Appearance.getColorScheme() ?? null;
  },
  set(value: ColorSchemeName): void {
    Appearance.setColorScheme(value);
    // "unspecified" is the closest match for the registry's "" (no scheme)
    getStyleRegistry().setColorScheme(value);
  },
};
