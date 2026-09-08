import { useId, useRef, type ComponentProps } from "react";
import { Pressable, View as RNView } from "react-native";

import { useElement } from "../../native/useElement";
import { useDualRefs } from "../../native/useRef";
import { useStyledProps } from "../../native/useStyled";
import { getStyleRegistry } from "../../specs/StyleRegistry";
import {
  copyComponentProperties,
  getDeepKeys,
  mergeStylesWithInline,
} from "../../utils";

export const View = copyComponentProperties(
  RNView,
  (p: ComponentProps<typeof RNView> & { onPress?: unknown; ref?: unknown }) => {
    const componentId = useId();
    const styled = useStyledProps(componentId, p.className, p);
    const ref = useDualRefs(componentId, p.ref);
    const StyleRegistry = getStyleRegistry();

    if (p.style) {
      StyleRegistry.updateComponentInlineStyleKeys(
        componentId,
        getDeepKeys(p.style),
      );
    }

    // Pressable only when interaction is wired — a plain View keeps upstream's
    // pass-through props semantics (no accessibilityState synthesis etc.).
    // Sticky: switching component type remounts the subtree, so once interactive
    // the instance stays Pressable even if the rules stop asking for it.
    const everInteractive = useRef(false);
    if (styled.interactive || typeof p.onPress === "function") {
      everInteractive.current = true;
    }
    const component = everInteractive.current
      ? (Pressable as unknown as typeof RNView)
      : RNView;

    // Layout events are only wired for containers (container queries) or when
    // the user supplied one — keeps rendered props identical to a plain View
    const needsLayout = styled.needsLayout || typeof p.onLayout === "function";

    return useElement(component, styled, {
      ...styled.props,
      ...p,
      ...(needsLayout
        ? {
            onLayout: (event: any) => {
              StyleRegistry.updateComponentLayout(
                componentId,
                event.nativeEvent.layout,
              );
              p.onLayout?.(event);
            },
          }
        : null),
      className: undefined,
      ...styled.importantProps,
      ref,
      // Flattened so inline styles beat className and !important beats
      // inline — matching upstream's resolved-style contract
      style: mergeStylesWithInline(styled.cleanStyle, styled),
    });
  },
);

export default View;
