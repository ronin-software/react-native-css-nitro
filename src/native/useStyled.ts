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

  const declarations = className
    ? StyleRegistry.getDeclarations(
        componentId,
        className,
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

  console.log("useStyled", { variableScope, containerScope });

  const componentData = useMemo(() => {
    if (!className) {
      return {};
    }

    const validAttributeQueries = validAttributeQueryIds.split(" ");
    // Remove the trailing empty string
    validAttributeQueries.pop();

    return StyleRegistry.registerComponent(
      componentId,
      rerender,
      className,
      variableScope,
      containerScope,
      validAttributeQueries,
    );
  }, [
    componentId,
    className,
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
