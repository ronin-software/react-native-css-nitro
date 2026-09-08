import { use, useEffect, useMemo, useReducer } from "react";

import {
  getStyleRegistry,
  type Declarations,
  type PseudoClassType,
} from "../specs/StyleRegistry";
import { testAttributeQuery } from "./attributeQuery";
import {
  ContainerContext,
  VariableContext,
  VariableValuesContext,
} from "./contexts";

const EMPTY_DECLARATIONS: Declarations = {};
const renderCount = new Map<unknown, number>();
const REDUCER = <T>(state: T) => ({ ...state });

/** Marker produced by styled(…, { passThrough: true }) */
const INLINE_RULE_SYMBOL = Symbol.for("react-native-css.inline-rule");
/** Marker produced by vars() */
const VARS_SYMBOL = Symbol.for("react-native-css.var");

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
  depth = 0,
  seen?: Set<object>,
): Record<string, any> | undefined {
  // Circular-reference guard (upstream has a depth limit too)
  if (depth > 12) {
    return undefined;
  }
  const nextDepth = depth + 1;
  const seenSet = seen ?? new Set<object>();
  if (typeof style === "object" && style !== null) {
    if (seenSet.has(style)) {
      return undefined; // circular — cut the reference
    }
    seenSet.add(style);
  }
  if (Array.isArray(style)) {
    const cleanedArray: any[] = [];
    for (const item of style) {
      if (isVarsMarker(item)) {
        collectVars(item, variables);
        continue;
      }
      const cleanedChild = extractMarkers(
        item,
        classNames,
        variables,
        undefined,
        nextDepth,
        seenSet,
      );
      // Drop items that lost all their properties to filtering (a widened
      // local so the null/object checks stay honest — cleanedChild is any[])
      const child: unknown = cleanedChild;
      if (
        child === undefined ||
        (child !== null &&
          typeof child === "object" &&
          !Array.isArray(child) &&
          Object.keys(child).length === 0)
      ) {
        continue;
      }
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
        const cleanedChild = extractMarkers(
          item,
          classNames,
          variables,
          undefined,
          nextDepth,
          seenSet,
        );
        cleanedArray.push(cleanedChild);
      }
      cleaned[key] = cleanedArray;
      continue;
    }
    if (value !== null && typeof value === "object") {
      const cleanedChild = extractMarkers(
        value,
        classNames,
        variables,
        undefined,
        nextDepth,
        seenSet,
      );
      if (cleanedChild !== undefined) {
        cleaned[key] = cleanedChild;
      }
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
  // Instrumentation: every call is one React render of a styled component.
  // Device e2e reads this to measure the shadow-write path's savings.
  const renderCounts = (globalThis as { __RN_CSS_RENDERS__?: Record<string, number> });
  renderCounts.__RN_CSS_RENDERS__ ??= {};
  renderCounts.__RN_CSS_RENDERS__.total =
    (renderCounts.__RN_CSS_RENDERS__.total ?? 0) + 1;
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

  if (
    process.env.NW_TRACE ||
    (globalThis as { __NW_TRACE__?: boolean }).__NW_TRACE__
  ) {
    renderCount.set(instance, (renderCount.get(instance) ?? 0) + 1);
    console.log(
      "RENDER",
      componentId,
      JSON.stringify(className),
      "x",
      renderCount.get(instance),
    );
  }

  let variableScope = use(VariableContext);
  let containerScope = use(ContainerContext);

  // Pass-through / vars() markers in the style prop extend this component's
  // classes and inline variables (upstream: INLINE_RULE_SYMBOL / VAR_SYMBOL)
  const inheritedVars = use(VariableValuesContext);
  const extraClassNames: string[] = [];
  const inlineVariables: Record<string, any> = {};
  const extracted = extractMarkers(
    originalProps.style,
    extraClassNames,
    inlineVariables,
  );
  // Fully-filtered styles resolve to undefined
  const cleanStyle =
    Array.isArray(extracted) && extracted.length === 0 ? undefined : extracted;
  // Inherited provider variables apply unless the component sets its own
  if (inheritedVars) {
    for (const [key, value] of Object.entries(inheritedVars)) {
      const bare = key.startsWith("--") ? key.slice(2) : key;
      if (!(bare in inlineVariables)) {
        inlineVariables[bare] = value;
      }
    }
  }
  const joined =
    extraClassNames.length > 0 ? extraClassNames.join(" ") : undefined;
  const effectiveClassName =
    className && extraClassNames.length
      ? `${className} ${extraClassNames.join(" ")}`
      : (className ?? joined);

  const inlineVarsKey = JSON.stringify(inlineVariables);
  useEffect(() => {
    StyleRegistry.updateComponentInlineVariables(componentId, inlineVariables);
  }, [componentId, inlineVarsKey]);

  // Shadow-write mode skips the React rerender on style changes, so the
  // JS-rendered props go stale — re-commit the computed styles after every
  // React commit to undo the stale props React just mounted. No-op unless
  // RN_CSS_SHADOW_WRITE is set.
  useEffect(() => {
    (StyleRegistry as { refreshShadowStyles?: (id: string) => void })
      .refreshShadowStyles?.(componentId);
  });

  const declarations = effectiveClassName
    ? StyleRegistry.getDeclarations(
        componentId,
        effectiveClassName,
        variableScope,
        containerScope,
      )
    : EMPTY_DECLARATIONS;

  // Publish props for group-attribute evaluation (children resolve
  // `.a.b .c`-style queries against their container's attributes). Only
  // primitive props are publishable — attribute queries read className and
  // disabled, and React elements (children) can't cross the JSI boundary.
  const publishable: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(originalProps)) {
    if (
      typeof value !== "undefined" &&
      (typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean")
    ) {
      publishable[key] = value;
    }
  }
  (
    StyleRegistry as {
      updateComponentAttributes?: (
        id: string,
        attrs: Record<string, unknown>,
      ) => void;
    }
  ).updateComponentAttributes?.(componentId, publishable);

  let validAttributeQueryIds = "";

  if (declarations.attributeQueries) {
    for (const [id, query] of declarations.attributeQueries) {
      const pass = testAttributeQuery(originalProps, query, isDisabled);
      if (process.env.NW_TRACE) {
        console.log(
          "AQ",
          id,
          JSON.stringify(query),
          "pass:",
          pass,
          "props:",
          JSON.stringify(originalProps),
        );
      }
      if (pass) {
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
    if (
      process.env.NW_TRACE ||
      (globalThis as { __NW_TRACE__?: boolean }).__NW_TRACE__
    ) {
      console.log(
        "REGISTER",
        componentId,
        JSON.stringify(effectiveClassName),
        "cScope:",
        containerScope,
      );
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

  // Update the container scope after we have registered the component, so it
  // doesn't use its own scope — the provider passes this to children
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

  // Wire state tracking only when needed: the component has its own pseudo
  // rules, is a group container (children reference its state), or carries
  // user handlers. Wiring every View as a responder steals touches from
  // children on iOS.
  const isGroupContainer =
    containerScope === componentId &&
    (declarations.containerScope !== undefined ||
      originalProps.className?.includes("/") === true);
  const hasPseudo =
    (declarations.active ?? false) ||
    (declarations.hover ?? false) ||
    (declarations.focus ?? false);
  // Widened: originalProps is Record<string, any> and `any` leaks into the
  // boolean chain below
  const pressProps: Record<string, unknown> = originalProps;
  const isFn = (v: unknown) => typeof v === "function";
  const interactive =
    hasPseudo ||
    isGroupContainer ||
    isFn(pressProps.onPress) ||
    isFn(pressProps.onPressIn) ||
    isFn(pressProps.onLongPress);

  if (interactive) {
    const userOnPress = originalProps.onPress;
    p.onPress = () => {
      if (typeof userOnPress === "function") {
        userOnPress();
      }
    };
    p.onPressIn = onPressIn(componentId, originalProps);
    p.onPressOut = onPressOut(componentId, originalProps);
  }

  if (declarations.hover || isGroupContainer) {
    p.onHoverIn = onHoverIn(componentId, originalProps);
    p.onHoverOut = onHoverOut(componentId, originalProps);
  }

  if (declarations.focus || isGroupContainer) {
    p.onFocus = onFocus(componentId, originalProps);
    p.onBlur = onBlur(componentId, originalProps);
  }

  return {
    props: componentData.props,
    importantProps: p,
    style: componentData.style,
    importantStyle: componentData.importantStyle,
    cleanStyle,
    variableScope,
    containerScope,
    interactive,
    /** Container components need layout events for container queries */
    needsLayout: declarations.containerScope !== undefined,
  };
}

// The original handler is captured before the wrapper is assigned to the
// props object, otherwise the wrapper would call itself
const stateHandler =
  (
    id: string,
    type: PseudoClassType,
    value: boolean,
    eventKey: string,
    props: Record<string, any>,
  ) =>
  () => {
    const original = props[eventKey];
    if (typeof original === "function") {
      original();
    }
    getStyleRegistry().updateComponentState(id, type, value);
  };

const onPressIn = (id: string, props: Record<string, any>) =>
  stateHandler(id, "active", true, "onPressIn", props);

const onPressOut = (id: string, props: Record<string, any>) =>
  stateHandler(id, "active", false, "onPressOut", props);

const onHoverIn = (id: string, props: Record<string, any>) =>
  stateHandler(id, "hover", true, "onHoverIn", props);

const onHoverOut = (id: string, props: Record<string, any>) =>
  stateHandler(id, "hover", false, "onHoverOut", props);

const onFocus = (id: string, props: Record<string, any>) =>
  stateHandler(id, "focus", true, "onFocus", props);

const onBlur = (id: string, props: Record<string, any>) =>
  stateHandler(id, "focus", false, "onBlur", props);
