// Styled primitives plus every react-native export we don't style — the metro
// resolver redirects bare "react-native" imports here, so this must be a
// drop-in superset of react-native for app code
export { FlatList } from "./FlatList";
export { ImageBackground } from "./ImageBackground";
export { SafeAreaProvider } from "./SafeAreaProvider";
export { TextInput } from "./TextInput";
export { ScrollView } from "./ScrollView";
export { Text } from "./Text";
export { View } from "./View";

export * from "react-native";
