/**
 * NativeWind-facing hook API: `useNativeCss` and `useCssElement` over this
 * repo's runtime. Mirrors the upstream `react-native-css/native` contract.
 */
export { useNativeCss } from "./useNativeCss";
export { styled, useCssElement, vars, usePassthrough, VAR_SYMBOL } from "../runtime";
export type { StyledConfiguration, StyledOptions } from "../runtime";
export { VariableContext, ContainerContext } from "./contexts";
export { useColorScheme } from "./useColorScheme";
