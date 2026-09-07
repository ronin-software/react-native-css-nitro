/**
 * End-to-end verification screen for react-native-css-nitro.
 *
 * Every element exercises a ported feature and carries a testID so the
 * Maestro flow + agent-device can assert on it. The CSS is compiled by the
 * Metro plugin at bundle time and injected via `import "./e2e.css"`.
 */
import { StyleSheet } from "react-native";

import { View } from "react-native-css-nitro/components/View";
import { Text } from "react-native-css-nitro/components/Text";
import {
  getStyleRegistry,
  multiply,
  specificity,
} from "react-native-css-nitro";

import "./e2e.css";

// Nitro C++ interop sanity: the hybrid object must answer 21
getStyleRegistry(); // force native registry creation before rendering

const Row = ({
  id,
  label,
  className,
}: {
  id: string;
  label: string;
  className: string;
}) => (
  <View testID={`${id}-row`} className="e2e-row">
    <Text testID={id} className={className}>
      {label}
    </Text>
  </View>
);

export default function App() {
  return (
    <View style={styles.container}>
      <Text testID="e2e-jsi" className="e2e-title">
        Multiply28: {multiply(3, 7)}
      </Text>
      <Row id="e2e-color" label="color" className="e2e-color" />
      <Row id="e2e-calc" label="calc" className="e2e-calc" />
      <Row id="e2e-var" label="variable" className="e2e-var" />
      <Row id="e2e-mq" label="media" className="e2e-mq" />
      <Row id="e2e-shadow" label="shadow" className="e2e-shadow" />
      <Row id="e2e-transform" label="transform" className="e2e-transform" />
      <Row id="e2e-press" label="press me" className="e2e-press" />
    </View>
  );
}

// Hand-written rule exercising the manual-registry path (same as before)
getStyleRegistry().addStyleSheet({
  s: {
    "e2e-title": [
      {
        s: specificity({ className: 1 }),
        d: { color: "#00aa00", fontSize: 22 },
      },
    ],
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
});
