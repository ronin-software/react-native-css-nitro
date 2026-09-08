/**
 * Visual showcase — every feature rendered live through the C++ runtime.
 * The CSS below is compiled by the Metro plugin at bundle time and
 * injected via `import "./e2e.css"`.
 *
 * Sections:
 *   1. C++ interop (multiply via Nitro hybrid object)
 *   2. Dark mode — class selectors driven by colorScheme.set
 *   3. Group selectors — pressing the card restyles the child
 *   4. Container queries — same child class, different container widths
 *   5. Compile-time + runtime features (calc, vars, media, shadow, transform)
 */
import { memo, useEffect, useState } from "react";

import { Text as RNText } from "react-native";
import { Pressable as RNPressable } from "react-native";

import { Text } from "react-native-css-nitro/components/Text";
import { View } from "react-native-css-nitro/components/View";
import {
  colorScheme,
  getStyleRegistry,
  multiply,
} from "react-native-css-nitro";

import "./e2e.css";

// Force native registry creation before first render
(globalThis as { __NW_TRACE__?: boolean }).__NW_TRACE__ = true;
getStyleRegistry();

/**
 * Standalone counter component: polls the render global with its own state and
 * renders a bare RN Text — its updates never touch the styled tree.
 */
const RenderCounter = memo(function RenderCounter() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const total =
        (globalThis as { __RN_CSS_RENDERS__?: { total?: number } })
          .__RN_CSS_RENDERS__?.total ?? 0;
      setN((prev) => (prev === total ? prev : total));
    }, 150);
    return () => clearInterval(t);
  }, []);
  return (
    <RNText
      testID="render-count"
      style={{ fontSize: 12, color: "#64748b", paddingHorizontal: 20 }}
    >
      styled renders: {n}
    </RNText>
  );
});

export default function App() {
  const [dark, setDark] = useState(false);
  const [rawProbe, setRawProbe] = useState(0);


  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    colorScheme.set(next ? "dark" : "light");
  };

  return (
    <View className={dark ? "screen dark" : "screen"}>
      <Text className="header" testID="showcase-header">
        react-native-css-nitro
      </Text>
      <Text className="subtitle">C++ runtime · multiply(3,7) = {multiply(3, 7)}</Text>

      <Text className="section">Dark mode (class selectors)</Text>
      <RNPressable
        onPress={() => setRawProbe((n) => n + 1)}
        hitSlop={8}
      >
        <Text className="subtitle">raw pressable probe: {rawProbe}</Text>
      </RNPressable>
      <View
        className="toggle"
        testID="dark-toggle"
        {...({ onPress: toggleDark } as Record<string, unknown> as { onPress: () => void })}
      >
        <Text className="toggle-text" testID="toggle-label">
          {dark ? "☀️ switch to light" : "🌙 switch to dark"}
        </Text>
      </View>
      <View
        className="toggle"
        testID="dark-toggle2"
        {...({ onPress: () => setRawProbe((n) => n + 100) } as Record<string, unknown> as { onPress: () => void })}
      >
        <Text className="toggle-text">styled-view probe: {rawProbe}</Text>
      </View>

      <View className="dark-card" testID="dark-card">
        <Text className="dark-text" testID="dark-card-text">
          {dark ? "🌙 dark styles active" : "☀️ light styles active"}
        </Text>
      </View>

      <RenderCounter />
      <Text className="section">Group selectors</Text>
      <View className="group/presscard group-card" testID="group-card">
        <Text className="group-hint">press and hold this card</Text>
        <Text className="group-child" testID="group-child">
          I change with my parent
        </Text>
      </View>

      <Text className="section">Container queries</Text>
      <View className="cq-frame" testID="cq-wide">
        <Text className="cq-child" testID="cq-wide-label">
          full width → green
        </Text>
      </View>
      <View className="cq-frame cq-narrow" testID="cq-narrow">
        <Text className="cq-child" testID="cq-narrow-label">
          half width → red
        </Text>
      </View>

      <Text className="section">Core features</Text>
      <View className="feature-grid">
        <Text className="feat-calc">calc</Text>
        <Text className="feat-var">var</Text>
        <Text className="feat-shadow">shadow</Text>
        <Text className="feat-transform">45°</Text>
      </View>
      <Text className="feat-mq" testID="mq-label">
        media query: ≥300px ✓
      </Text>
    </View>
  );
}
