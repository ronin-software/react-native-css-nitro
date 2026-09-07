import { use, useEffect, useMemo, useReducer } from "react";

import {
  getStyleRegistry,
  type Declarations,
  type PseudoClassType,
} from "../specs/StyleRegistry";
import { testAttributeQuery } from "./attributeQuery";
import { ContainerContext, VariableContext, VariableValuesContext } from "./contexts";

const EMPTY_DECLARATIONS: Declarations = {};
const renderCount = new Map<unknown, number>();
const REDUCER = <T>(state: T) => ({ ...state });

/** Marker produced by styled(…, { passThrough: true }) */
const INLINE_RULE_SYMBOL = Symbol.for("react-native-css.inline-rule");
/** Marker produced by vars() */
const VARS_SYMBOL = Symbol.for("react-native-css.vars");

/**
 * Extract classNames and inline variables from pass-through/vars markers
 * embedded in a style prop, and produce a marker-free copy of the style.
 * Marker objects in property-value positions are dropped (upstream
 * rightIsInline semantics: only literal values pass through).
 */
function extractMarkers(
  style: unknown,
  classNames: string[],
  variables: Record<string, any>,
  clean?: Record<string, any>,
): Record<string, any> | undefined {
  if (Array.isArray(style)) {
    const cleanedArray: any[] = [];
    for (const item of style) {
      if (isVarsMarker(item)) {
        collectVars(item, variables);
        continue;
      }
      const cleanedChild = extractMarkers(item, classNames, variables);
      cleanedArray.push(cleanedChild);
    }
    if (clean) {
      Object.assign(clean, cleanedArray);
      return undefined;
    }
    return cleanedArray as any;
  }
  if (!style || typeof style !== "object") {
    return style as any;
  }
  const record = style as Record<PropertyKey, unknown>;
  const inline = record[INLINE_RULE_SYMBOL];
  if (typeof inline === "string") {
    classNames.push(...inline.split(/\s+/).filter(Boolean));
  }
  if (VARS_SYMBOL in record) {
    collectVars(record as Record<string, any>, variables);
    return undefined; // marker objects are dropped from styles
  }

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isVarsMarker(value)) {
      collectVars(value as Record<string, any>, variables);
      continue;
    }
    if (Array.isArray(value)) {
      const cleanedArray: any[] = [];
      for (const item of value) {
        if (isVarsMarker(item)) {
          collectVars(item as Record<string, any>, variables);
          continue;
        }
        const cleanedChild = extractMarkers(item, classNames, variables);
        cleanedArray.push(cleanedChild);
      }
      cleaned[key] = cleanedArray;
      continue;
    }
    if (value !== null && typeof value === "object") {
      cleaned[key] = extractMarkers(value, classNames, variables);
      continue;
    }
    cleaned[key] = value;
  }
  if (clean) {
    Object.assign(clean, cleaned);
    return undefined;
  }
  return cleaned;
}

function isVarsMarker(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    VARS_SYMBOL in value
  );
}

function collectVars(
  marker: Record<string, any>,
  variables: Record<string, any>,
): void {
  for (const [key, value] of Object.entries(marker)) {
    if (key !== String(VARS_SYMBOL)) {
      const bare = key.startsWith("--") ? key.slice(2) : key;
      variables[bare] = value;
    }
  }
}

export function useStyledProps(
  componentId: string,
  className: string | undefined,
  originalProps: Record<string, any>,
  isDisabled = false,
) {
  const [instance, rerender] = useReducer(REDUCER, EMPTY_DECLARATIONS);
  const StyleRegistry = getStyleRegistry();
  const registry = StyleRegistry as {
    renderPaused?: boolean;
    resumeRender?: () => void;
  };
  registry.renderPaused = true;
  useEffect(() => {
    // Commit finished — resume notifies and flush render-phase changes
    registry.resumeRender?.();
  });

  if (process.env.NW_TRACE) {
    renderCount.set(instance, (renderCount.get(instance) ?? 0) + 1);
    console.log('RENDER', componentId, 'x', renderCount.get(instance));
  }

  let variableScope = use(VariableContext);
  let containerScope = use(ContainerContext);

  // Pass-through / vars() markers in the style prop extend this component's
  // classes and inline variables (upstream: INLINE_RULE_SYMBOL / VAR_SYMBOL)
  const inheritedVars = use(VariableValuesContext);
  const extraClassNames: string[] = [];
  const inlineVariables: Record<string, any> = {};
  const cleanStyle = extractMarkers(
    originalProps.style,
    extraClassNames,
    inlineVariables,
  );
  // Inherited provider variables apply unless the component sets its own
  if (inheritedVars) {
    for (const [key, value] of Object.entries(inheritedVars)) {
      const bare = key.startsWith("--") ? key.slice(2) : key;
      if (!(bare in inlineVariables)) {
        inlineVariables[bare] = value;
      }
    }
  }
  const effectiveClassName =
    className && extraClassNames.length
      ? `${className} ${extraClassNames.join(" ")}`
      : className || extraClassNames.join(" ") || undefined;

  const inlineVarsKey = JSON.stringify(inlineVariables);
  useEffect(() => {
    StyleRegistry.updateComponentInlineVariables(componentId, inlineVariables);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componentId, inlineVarsKey]);

  const declarations = effectiveClassName
    ? StyleRegistry.getDeclarations(
        componentId,
        effectiveClassName,
        variableScope,
        containerScope,
      )
    : EMPTY_DECLARATIONS;

  let validAttributeQueryIds = "";

  if (declarations.attributeQueries) {
    for (const [id, query] of declarations.attributeQueries) {
      if (testAttributeQuery(originalProps, query, isDisabled)) {
        validAttributeQueryIds += id + " ";
      }
    }
  }

  // Update the variable scope after we have retrieved the declarations, so it uses its own scope
  variableScope = declarations.variableScope ?? variableScope;


  const componentData = useMemo(() => {
    if (!effectiveClassName) {
      return {};
    }

    const validAttributeQueries = validAttributeQueryIds.split(" ");
    // Remove the trailing empty string
    validAttributeQueries.pop();

    return StyleRegistry.registerComponent(
      componentId,
      rerender,
      effectiveClassName,
      variableScope,
      containerScope,
      validAttributeQueries,
    );
  }, [
    componentId,
    effectiveClassName,
    variableScope,
    containerScope,
    validAttributeQueryIds,
    // This is not used, but if the registry fires a rerender it will have a different identity
    instance,
  ]);

  // Update the container scope after we have registered the component, so it doesn't use its own scope
  containerScope = declarations.containerScope ?? containerScope;

  const p: Record<string, unknown> = {
    ...componentData.importantProps,
  };

  useEffect(
    () => () => {
      // StyleRegistry.deregisterComponent(componentId);
    },
    [componentId],
  );

  if (declarations.active) {
    p.onPress =
      p.onPress ??
      (() => {
        return;
      });
    p.onPressIn = onPressIn(componentId, p);
    p.onPressOut = onPressOut(componentId, p);
  }

  if (declarations.hover) {
    p.onHoverIn = onHoverIn(componentId, p);
    p.onHoverOut = onHoverOut(componentId, p);
  }

  if (declarations.focus) {
    p.onFocus = onFocus(componentId, p);
    p.onBlur = onBlur(componentId, p);
  }

  return {
    props: componentData.props,
    importantProps: p,
    style: componentData.style,
    importantStyle: componentData.importantStyle,
    cleanStyle,
    variableScope,
    containerScope,
  };
}

// The original handler is captured before the wrapper is assigned to the
// props object, otherwise the wrapper would call itself
const stateHandler =
  (id: string, type: PseudoClassType, value: boolean, eventKey: string) =>
  (props: Record<string, any>) => {
    const original = props[eventKey];
    return () => {
      if (typeof original === "function") {
        original();
      }
      getStyleRegistry().updateComponentState(id, type, value);
    };
  };

const onPressIn = (id: string, props: Record<string, any>) =>
  stateHandler(id, "active", true, "onPressIn")(props);

const onPressOut = (id: string, props: Record<string, any>) =>
  stateHandler(id, "active", false, "onPressOut")(props);

const onHoverIn = (id: string, props: Record<string, any>) =>
  stateHandler(id, "hover", true, "onHoverIn")(props);

const onHoverOut = (id: string, props: Record<string, any>) =>
  stateHandler(id, "hover", false, "onHoverOut")(props);

const onFocus = (id: string, props: Record<string, any>) =>
  stateHandler(id, "focus", true, "onFocus")(props);

const onBlur = (id: string, props: Record<string, any>) =>
  stateHandler(id, "focus", false, "onBlur")(props);
