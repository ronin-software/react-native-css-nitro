import { createElement, type ComponentType, type ReactElement } from "react";

/**
 * `useNativeCss(baseComponent, props, mapping?)` — hook form of the styled
 * adapter. Returns the props to spread onto the rendered element.
 */

import {
  mappingToConfig,
  useStyledComponent,
  type Config,
  type StyledConfiguration,
} from "../runtime";

export function mappingToConfigs(
  mapping: StyledConfiguration = { className: "style" },
): Config[] {
  return mappingToConfig(mapping);
}

export function useNativeCss<
  const C extends ComponentType<any>,
  const M extends StyledConfiguration,
>(
  baseComponent: C,
  props: Record<string, any>,
  mapping: M = { className: "style" } as unknown as M,
): ReactElement {
  const configs = mappingToConfigs(mapping);
  const element = useStyledComponent(baseComponent, props, configs) as {
    type: ComponentType<any>;
    props: Record<string, any>;
  };
  // Flatten the style to a single object (upstream contract)
  return createElement(element.type, { ...element.props });
}

