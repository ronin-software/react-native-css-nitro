import { useId, type ComponentProps } from "react";
import { Pressable, StyleSheet } from "react-native";

import { createAnimatedComponent } from "react-native-reanimated";

import { useElement } from "../../native/useElement";
import { useDualRefs } from "../../native/useRef";
import { useStyledProps } from "../../native/useStyled";
import { getStyleRegistry } from "../../specs/StyleRegistry";
import { copyComponentProperties, getDeepKeys } from "../../utils";

const AnimatedView = createAnimatedComponent(Pressable);

export const View = copyComponentProperties(
  AnimatedView,
  (p: ComponentProps<typeof AnimatedView>) => {
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

    return useElement(AnimatedView, styled, {
      ...styled.props,
      ...p,
      ...styled.importantProps,
      ref,
      // Flattened so inline styles beat className and !important beats
      // inline — matching upstream's resolved-style contract
      style:
        styled.style || styled.importantStyle
          ? StyleSheet.flatten([styled.style, p.style, styled.importantStyle])
          : p.style,
    });
  },
);

export default View;
