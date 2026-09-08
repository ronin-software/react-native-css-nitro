import { useContext, useMemo, type PropsWithChildren } from "react";

import {
  SafeAreaProvider as OriginalSafeAreaProvider,
  useSafeAreaInsets,
  type SafeAreaProviderProps,
} from "react-native-safe-area-context";

import { VariableValuesContext } from "../../native/contexts";
import { VariableContextProvider } from "../../runtime";

export function SafeAreaProvider({
  children,
  ...props
}: PropsWithChildren<SafeAreaProviderProps>) {
  return (
    <OriginalSafeAreaProvider {...props}>
      <SafeAreaEnv>{children}</SafeAreaEnv>
    </OriginalSafeAreaProvider>
  );
}

function SafeAreaEnv({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  const parentVars = useContext(VariableValuesContext) ?? {};

  const value = useMemo(
    () => ({
      ...parentVars,
      "--react-native-css-safe-area-inset-bottom": insets.bottom,
      "--react-native-css-safe-area-inset-left": insets.left,
      "--react-native-css-safe-area-inset-right": insets.right,
      "--react-native-css-safe-area-inset-top": insets.top,
    }),
    [parentVars, insets],
  );

  return (
    <VariableContextProvider value={value}>{children}</VariableContextProvider>
  );
}
