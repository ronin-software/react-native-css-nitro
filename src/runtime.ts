/**
 * NativeWind-facing runtime API: `styled`, `useCssElement`, `usePassthrough`,
 * and `vars`. Ports the upstream contract onto this repo's runtime
 * (`useStyledProps` + the C++ StyleRegistry).
 */
import {
  createElement,
  use,
  useContext,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";

import { ContainerContext, VariableValuesContext } from "./native/contexts";
import { useStyledProps } from "./native/useStyled";
import { getStyleRegistry } from "./specs/StyleRegistry";
import { mergeStylesWithInline, stripStyleMarkers } from "./utils";

/** Marks an object produced by vars() as inline variable declarations */
export const VAR_SYMBOL = Symbol.for("react-native-css.var");

export type StyledConfiguration<C = unknown> = Record<
  string,
  string | boolean | string[] | Record<string, string> | C
>;

export interface StyledOptions {
  passThrough?: boolean;
}

export interface Config {
  source: string;
  target: string[] | string | false;
  /** Style keys extracted into the component's own props (e.g. TextInput's
   * textAlign) instead of staying in the style object */
  nativeStyleMapping?: Record<string, string | boolean>;
}

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
    if (typeof value === "object" && value !== null && "target" in value) {
      // object form: { target, nativeStyleMapping? }
      const { target, nativeStyleMapping } = value as {
        target: unknown;
        nativeStyleMapping?: Record<string, string | boolean>;
      };
      const native = nativeStyleMapping as Config["nativeStyleMapping"];
      if (target === false) {
        return [{ source: key, target: false, nativeStyleMapping: native }];
      }
      if (typeof target === "string") {
        return [{ source: key, target: target.split("."), nativeStyleMapping: native }];
      }
      if (Array.isArray(target)) {
        return [{ source: key, target, nativeStyleMapping: native }];
      }
    }
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

/** Props of a styled()-wrapped component: base props plus className keys */
export type StyledProps<P, M extends StyledConfiguration> = P & {
  [K in keyof M as K extends string
    ? M[K] extends undefined | false
      ? never
      : M[K] extends true | string | object
        ? K
        : never
    : never]?: string;
};

/**
 * Upstream pass-through: no registry, no React state — the className is
 * appended to the target style AFTER the inline styles, so inline wins.
 * The marker object is inert to React Native's style system.
 */
export function usePassthrough(
  type: ComponentType<any>,
  props: Record<string, any>,
  configs: Config[],
) {
  // A fresh copy per render — the caller's props object is never mutated
  props = { ...props };
  for (const config of configs) {
    let { source, target } = config;

    const classNames = props[source];

    // A fresh inert object per render; symbol keys are ignored by RN
    const styles: Record<PropertyKey, unknown> = {
      [Symbol.for("react-native-css.inline-rule")]: classNames,
    };

    props = Object.fromEntries(
      Object.entries(props).filter(([key]) => key !== source),
    );

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
  initialProps: Record<string, any>,
  configs: Config[],
) {
  const props = initialProps;
  const active = configs.filter((c) => c.target !== false);
  // configs are static per call site — ids are stable for the mount lifetime
  const componentId = useMemo(
    () => active.map(() => `styled-${Math.random().toString(36).slice(2)}`),
    [],
  );

  // One styled resolution per active config (multi-target support:
  // FlatList's className/contentContainerClassName/etc.)
  const styledResults = active.map((config, i) => {
    const className = props[config.source];
    const styled = useStyledProps(componentId[i] ?? "", className, props);
    return { config, styled };
  });

  // Register vars() markers against the primary component. The registry's
  // observable triggers the C++ computed re-evaluation, which re-renders the
  // component with the resolved values.

  // Build the output props; consumed className sources are removed
  const consumed = new Set(active.map((config) => config.source));
  const out: Record<string, any> = Object.fromEntries(
    Object.entries(props).filter(([key]) => !consumed.has(key)),
  );

  for (const { config, styled } of styledResults) {
    const target = Array.isArray(config.target)
      ? (config.target[config.target.length - 1] ?? "")
      : config.target;
    if (!target) {
      continue;
    }

    // Strip markers from this target's user value before merging.
    // (Non-primary pass-through className markers are rare and unresolved.)
    const collected = { classNames: [], variables: {} };
    const userClean = stripStyleMarkers(out[target], collected);
    const merged = mergeStylesWithInline(userClean, styled);

    // nativeStyleMapping: extract style keys into the component's own props
    // (e.g. { textAlign: true } moves style.textAlign → props.textAlign).
    // Boolean true maps the key to itself; a string maps to a different prop.
    if (config.nativeStyleMapping && !Array.isArray(merged)) {
      for (const [styleKey, propOrFlag] of Object.entries(config.nativeStyleMapping)) {
        const styles = Array.isArray(merged) ? merged : [merged];
        for (const s of styles) {
          if (s && typeof s === "object" && styleKey in s) {
            const extracted = s[styleKey];
            delete s[styleKey];
            if (extracted !== undefined) {
              out[typeof propOrFlag === "string" ? propOrFlag : styleKey] = extracted;
            }
          }
        }
      }
    }

    out[target] = merged;
  }

  return createElement(type, out);
}

/**
 * Inherited inline variable VALUES (from VariableContextProvider).
 * Distinct from VariableContext (a scope identifier for rule cascades).
 */
export function VariableContextProvider(props: {
  value: Record<string, any>;
  children: ReactNode;
}) {
  const inherited = useContext(VariableValuesContext) ?? {};
  const value = useMemo(
    () => ({ ...inherited, ...props.value }),
    [inherited, props.value],
  );
  return createElement(
    VariableValuesContext.Provider,
    { value },
    props.children,
  );
}

/**
 * styled() HOC: wraps a base component and applies styles from className.
 * Mirrors upstream's react-native-css `styled` contract.
 */
export function styled<const M extends StyledConfiguration>(
  baseComponent: ComponentType<any>,
  mapping: M = { className: "style" } as unknown as M,
  options?: StyledOptions,
) {
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
 * Reads a CSS variable's resolved value for the current variable scope.
 * Upstream-parity API (native side); re-renders when the value changes.
 */
export function useUnstableNativeVariable(name: string): unknown {
  if (name.startsWith("--")) {
    name = name.slice(2);
  }
  const scope = use(ContainerContext);
  const registry = getStyleRegistry() as {
    getVariableValue?: (scope: string, name: string) => unknown;
  };
  // Reads are snapshot-only for now: no per-variable observable subscription
  return registry.getVariableValue?.(scope, name);
}

/**
 * Applies styles to an existing element's props (the babel-plugin entry).
 */
export function useCssElement<const M extends StyledConfiguration>(
  component: ComponentType<any>,
  incomingProps: Record<string, any>,
  mapping: M = { className: "style" } as unknown as M,
) {
  const configs = mappingToConfig(mapping);
  const element = component as {
    type?: ComponentType<any>;
    props?: Record<string, any>;
  };
  const type = element.type ?? component;
  const baseProps = element.props ?? {};
  const props = { ...baseProps, ...incomingProps };
  return useStyledComponent(type, props, configs);
}

function getDisplayName(component: unknown): string {
  const c = component as { displayName?: string; name?: string };
  return c.displayName ?? c.name ?? "unknown";
}

export { useColorScheme } from "./native/useColorScheme";
export { colorScheme } from "./native/colorScheme";
