import { SafeAreaProvider as OriginalSafeAreaProvider } from "react-native-safe-area-context";

export function SafeAreaProvider({
  children,
  ...props
}: React.ComponentProps<typeof OriginalSafeAreaProvider>) {
  // Web has no insets — pass through
  return (
    <OriginalSafeAreaProvider {...props}>{children}</OriginalSafeAreaProvider>
  );
}
