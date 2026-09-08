import { useId, type ComponentPropsWithRef } from "react";
import { Text as RNText, } from "react-native";

import { createAnimatedComponent } from "react-native-reanimated";

import { useElement } from "../../native/useElement";
import { useDualRefs } from "../../native/useRef";
import { useStyledProps } from "../../native/useStyled";
import { getStyleRegistry } from "../../specs/StyleRegistry";
import {
  copyComponentProperties,
  getDeepKeys,
  mergeStylesWithInline,
} from "../../utils";

const AnimatedText = createAnimatedComponent(RNText);

export const Text = copyComponentProperties(
  RNText,
  (p: ComponentPropsWithRef<typeof AnimatedText>) => {
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

    return useElement(AnimatedText, styled, {
      ...styled.props,
      ...p,
      onLayout: (event: any) => {
        StyleRegistry.updateComponentLayout(componentId, event.nativeEvent.layout);
        p.onLayout?.(event);
      },
      className: undefined,
      ...styled.importantProps,
      ref,
      // Flattened so inline styles beat className and !important beats
      // inline — matching upstream's resolved-style contract
      style: mergeStylesWithInline(styled.cleanStyle, styled),
    });
  },
);

export default Text;
