import { Appearance } from "react-native";

/** Port of upstream's colorScheme helper on top of the RN Appearance API */
export function useColorScheme() {
  return {
    colorScheme: Appearance.getColorScheme(),
    setColorScheme(scheme: string | null) {
      Appearance.setColorScheme(scheme as never);
    },
    toggleColorScheme() {
      Appearance.setColorScheme(
        Appearance.getColorScheme() === "dark" ? "light" : "dark",
      );
    },
  };
}
