import { use, useEffect, useMemo, useReducer } from "react";

import {
  getStyleRegistry,
  type Declarations,
  type PseudoClassType,
} from "../specs/StyleRegistry";
import { testAttributeQuery } from "./attributeQuery";
import { ContainerContext, VariableContext } from "./contexts";

const EMPTY_DECLARATIONS: Declarations = {};
const REDUCER = <T>(state: T) => ({ ...state });

/** Marker produced by styled(…, { passThrough: true }) */
const INLINE_RULE_SYMBOL = Symbol.for("react-native-css.inline-rule");
/** Marker produced by vars() */
const VARS_SYMBOL = Symbol.for("react-native-css.vars");

/**
 * Extract classNames and inline variables from pass-through/vars markers
 * embedded in a style prop (array or object).
 */
function extractMarkers(
  style: unknown,
  classNames: string[],
  variables: Record<string, any>,
): void {
  if (!style || typeof style !== "object") {
    return;
  }
  if (Array.isArray(style)) {
    for (const item of style) {
      extractMarkers(item, classNames, variables);
    }
    return;
  }
  const record = style as Record<PropertyKey, unknown>;
  const inline = record[INLINE_RULE_SYMBOL];
  if (typeof inline === "string") {
    classNames.push(...inline.split(/\s+/).filter(Boolean));
  }
  if (VARS_SYMBOL in record) {
    for (const [key, value] of Object.entries(record)) {
      if (key !== String(VARS_SYMBOL)) {
        variables[key] = value;
      }
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

  let variableScope = use(VariableContext);
  let containerScope = use(ContainerContext);

  // Pass-through / vars() markers in the style prop extend this component's
  // classes and inline variables (upstream: INLINE_RULE_SYMBOL / VAR_SYMBOL)
  const extraClassNames: string[] = [];
  const inlineVariables: Record<string, any> = {};
  extractMarkers(originalProps.style, extraClassNames, inlineVariables);
  const effectiveClassName =
    className && extraClassNames.length
      ? `${className} ${extraClassNames.join(" ")}`
      : className || extraClassNames.join(" ") || undefined;

  const inlineVarsKey = JSON.stringify(inlineVariables);
  useMemo(() => {
    if (Object.keys(inlineVariables).length === 0) {
      return;
    }
    StyleRegistry.updateComponentInlineVariables(componentId, inlineVariables);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineVarsKey]);

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
