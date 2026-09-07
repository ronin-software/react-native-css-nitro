/**
 * NativeWind-facing runtime API: `styled`, `useCssElement`, `usePassthrough`,
 * and `vars`. Ports the upstream contract onto this repo's runtime
 * (`useStyledProps` + the C++ StyleRegistry).
 */
import { createElement, useMemo, type ComponentType } from "react";

import { useStyledProps } from "./native/useStyled";
import { getStyleRegistry } from "./specs/StyleRegistry";

/** Marks an object produced by vars() as inline variable declarations */
export const VAR_SYMBOL = Symbol.for("react-native-css.vars");

export type StyledConfiguration = Record<
  string,
  string | boolean | string[] | Record<string, string>
>;

export interface StyledOptions {
  passThrough?: boolean;
}

export type Config = {
  source: string;
  target: string[] | string | false;
};

/** Port of upstream mappingToConfig: {className: "style"} → configs */
export function mappingToConfig(mapping: StyledConfiguration): Config[] {
  return Object.entries(mapping).flatMap(([key, value]): Config[] => {
    if (value === true) {
      return [{ source: key, target: key }];
    }
    if (value === false) {
      return [{ source: key, target: false }];
    }
    if (typeof value === "string") {
      return [{ source: key, target: value.split(".") }];
    }
    if (Array.isArray(value)) {
      return [{ source: key, target: value }];
    }
    // object form (nativeStyleMapping) is not supported yet
    return [];
  });
}

/**
 * Inline variables: vars({ "--brand": "#f00" }) produces a marker object.
 * The component wrapper strips the marker and registers the variables with
 * the registry against the component's scope.
 */
export function vars(variables: Record<string, any>): Record<string, any> {
  return { [VAR_SYMBOL]: "inline", ...variables };
}

function isVarsMarker(value: unknown): value is Record<string, any> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    VAR_SYMBOL in value
  );
}

/**
 * Upstream pass-through: no registry, no React state — the className is
 * appended to the target style AFTER the inline styles, so inline wins.
 * The marker object is inert to React Native's style system.
 */
export function usePassthrough(
  type: ComponentType<any>,
  { ...props }: Record<string, any>,
  configs: Config[],
) {
  for (const config of configs) {
    let { source, target } = config;

    const classNames = props[source];

    // A fresh inert object per render; symbol keys are ignored by RN
    const styles: Record<PropertyKey, unknown> = {
      [Symbol.for("react-native-css.inline-rule")]: classNames,
    };

    delete props[source];

    if (classNames === undefined || target === false) {
      continue;
    }

    let targetProps = props;

    if (Array.isArray(target)) {
      for (let i = 0; i < target.length - 1; i++) {
        const prop = target[i];
        if (prop === undefined) {
          continue;
        }
        props[prop] ??= {};
        targetProps = props[prop];
      }
      const last = target[target.length - 1];
      if (last === undefined) {
        continue;
      }
      target = last;
    }

    if (Array.isArray(targetProps[target])) {
      targetProps[target] = [...targetProps[target], styles];
    } else if (targetProps[target]) {
      targetProps[target] = [targetProps[target], styles];
    } else {
      targetProps[target] = styles;
    }
  }

  return createElement(type, props);
}

/**
 * Core adapter: applies this runtime's styling to a base component given the
 * mapping configs. Handles vars() markers via the registry's per-component
 * inline variables.
 */
export function useStyledComponent(
  type: ComponentType<any>,
  props: Record<string, any>,
  configs: Config[],
) {
  const primary = configs[0];
  const classNameSource = primary?.source ?? "className";
  const className = props[classNameSource];

  // Stable per element instance
  const componentId = useMemo(
    () => `styled-${Math.random().toString(36).slice(2)}`,
    [],
  );

  const styled = useStyledProps(componentId, className, props);

  // Register vars() markers (inline variables) against this component.
  // The registry's observable triggers the C++ computed re-evaluation, which
  // re-renders the component with the resolved values.
  const styleProp = props.style;
  const varsKey = isVarsMarker(styleProp) ? JSON.stringify(styleProp) : "";

  useMemo(() => {
    if (!varsKey) {
      return;
    }
    const marker = JSON.parse(varsKey) as Record<string, any>;
    const variables: Record<string, any> = {};
    for (const [key, value] of Object.entries(marker)) {
      if (key !== String(VAR_SYMBOL)) continue;
      variables[key] = value;
    }
    getStyleRegistry().updateComponentInlineVariables(componentId, variables);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varsKey]);

  // Build the output props following upstream's merge order:
  // styled props → user props → important styled props
  const out: Record<string, any> = {
    ...props,
  };
  delete out[classNameSource];

  for (const config of configs) {
    if (config.source === classNameSource || config.target === false) {
      continue;
    }
    // Additional targets (e.g. contentContainerStyle) share the primary
    // resolution for now — multi-config resolution is not implemented yet
  }

  const hasStyled = styled.style || styled.importantStyle;
  out.style =
    hasStyled || props.style
      ? [
          styled.style,
          Array.isArray(props.style) ? props.style : [props.style],
          styled.importantStyle,
        ].flat()
      : props.style;

  Object.assign(out, styled.importantProps);
  if (styled.props) {
    for (const [key, value] of Object.entries(styled.props)) {
      if (!(key in props)) {
        out[key] = value;
      }
    }
  }

  return createElement(type, out);
}

/**
 * styled() HOC: wraps a base component and applies styles from className.
 * Mirrors upstream's react-native-css `styled` contract.
 */
export function styled<
  const C extends ComponentType<any>,
  const M extends StyledConfiguration,
>(baseComponent: C, mapping: M = { className: "style" } as unknown as M, options?: StyledOptions) {
  const configs = mappingToConfig(mapping);

  if (options?.passThrough) {
    const Passthrough = (props: Record<string, any>) =>
      usePassthrough(baseComponent, props, configs);
    Passthrough.displayName = `CssInterop.${getDisplayName(baseComponent)}`;
    return Passthrough;
  }

  const StyledComponent = (props: Record<string, any>) =>
    useStyledComponent(baseComponent, props, configs);
  StyledComponent.displayName = `CssInterop.${getDisplayName(baseComponent)}`;
  return StyledComponent;
}

/**
 * Applies styles to an existing element's props (the babel-plugin entry).
 */
export function useCssElement<
  const C extends ComponentType<any>,
  const M extends StyledConfiguration,
>(
  component: C,
  incomingProps: Record<string, any>,
  mapping: M = { className: "style" } as unknown as M,
) {
  const configs = mappingToConfig(mapping);
  const element = component as { type?: ComponentType<any>; props?: Record<string, any> };
  const type = (element.type ?? component) as ComponentType<any>;
  const baseProps = element.props ?? {};
  const props = { ...baseProps, ...incomingProps };
  return useStyledComponent(type, props, configs);
}

function getDisplayName(component: ComponentType<any> | unknown): string {
  const c = component as { displayName?: string; name?: string };
  return c?.displayName ?? c?.name ?? "unknown";
}

export { useColorScheme } from "./native/useColorScheme";
