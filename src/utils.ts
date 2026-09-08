import type { ComponentType } from "react";

export function copyComponentProperties<P1, P2>(
  Component: ComponentType<P1>,
  StyledComponent: ComponentType<P2>,
) {
  Object.entries(Component as Record<string, any>).forEach(([key, value]) => {
    // Filter out the keys we don't want to copy
    if (["$$typeof", "render"].includes(key)) {
      return;
    }

    StyledComponent[key as keyof ComponentType<P2>] = value;
  });

  StyledComponent.displayName = Component.displayName;

  return StyledComponent as ComponentType<P1 & P2>;
}

export function getDeepKeys(
  obj: unknown,
  keys = new Set<string>(),
  depth = 0,
  seen = new Set<object>(),
): string[] {
  // Circular-reference and depth guard
  if (typeof obj !== "object" || !obj || depth > 12 || seen.has(obj)) {
    return [];
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      getDeepKeys(item, keys, depth + 1, seen);
    }
  } else {
    for (const key of Object.keys(obj)) {
      keys.add(key);
      getDeepKeys((obj as Record<string, unknown>)[key], keys, depth + 1, seen);
    }
  }

  return Array.from(keys);
}

/**
 * Upstream's resolved-style contract:
 * - important styles beat inline and className
 * - inline beats className on shared keys
 * - disjoint className + inline styles stay an array (RN applies in order)
 */

/** Plain object with no keys — must not create style layers (upstream #239) */
function isEmptyPlainObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

export function mergeStylesWithInline(
  userStyle: any,
  styled: { style?: any; importantStyle?: any },
): any {
  const classNameLayers = [
    ...(Array.isArray(styled.style) ? styled.style : [styled.style]),
    ...(Array.isArray(styled.importantStyle)
      ? styled.importantStyle
      : [styled.importantStyle]),
  ].filter((layer) => Boolean(layer) && !isEmptyPlainObject(layer));


  // Important beats everything: one resolved object
  if (styled.importantStyle) {
    const merged: Record<string, any> = {};
    for (const layer of [
      ...(Array.isArray(userStyle) ? userStyle : [userStyle]),
      ...classNameLayers,
    ]) {
      if (layer) {
        Object.assign(merged, layer);
      }
    }
    return merged;
  }

  // The user style is ONE layer (arrays stay nested — RN resolves them);
  // fully-filtered empty arrays count as no inline styles
  const userIsEmptyArray = Array.isArray(userStyle) && userStyle.length === 0;
  const inlineLayers = [userStyle].filter(
    (layer) =>
      layer !== undefined &&
      layer !== null &&
      !(Array.isArray(layer) && layer.length === 0) &&
      !isEmptyPlainObject(layer),
  );
  const hasInline = !userIsEmptyArray && inlineLayers.length > 0;  if (classNameLayers.length === 0) {
    // All inline values filtered out → no style
    const hasLiteral = inlineLayers.some((layer) => {
      if (layer === undefined || layer === null || isEmptyPlainObject(layer)) {
        return false;
      }
      if (Array.isArray(layer)) {
        return layer.length > 0;
      }
      return Object.keys(layer).length > 0;
    });
    return hasLiteral ? userStyle : undefined;
  }

  if (!hasInline) {
    // className only: single object when one layer, else the cascade array
    return classNameLayers.length === 1 ? classNameLayers[0] : classNameLayers;
  }

  // Conflicts between className and inline?
  const classNameKeys = new Set(
    classNameLayers.flatMap((layer) => (layer ? Object.keys(layer) : [])),
  );
  const inlineKeys = new Set(
    inlineLayers.flatMap((layer) => (layer ? Object.keys(layer) : [])),
  );
  const conflicts = [...classNameKeys].filter((key) => inlineKeys.has(key));

  if (conflicts.length === 0) {
    // Disjoint: preserve both layers as an array
    return [...classNameLayers, ...inlineLayers];
  }

  // Conflicts: if the className layer has non-conflicting keys, keep the full
  // className layer (conflicting keys included — inline wins by array order)
  // and append the inline layers
  const hasNonConflictingKeys = classNameLayers.some(
    (layer) =>
      layer && Object.keys(layer).some((key) => !inlineKeys.has(key)),
  );

  const merged: Record<string, any> = {};
  for (const layer of [...classNameLayers, ...inlineLayers]) {
    if (layer) {
      Object.assign(merged, layer);
    }
  }

  if (hasNonConflictingKeys) {
    // Keep the className layer pure className — inline wins by array order
    const classNameMerged: Record<string, any> = {};
    for (const layer of classNameLayers) {
      if (layer) {
        Object.assign(classNameMerged, layer);
      }
    }
    return [classNameMerged, ...inlineLayers];
  }

  // Every className key conflicts: inline wins in one resolved object
  return merged;
}

/** Marker symbols (global registry — matches runtime/useStyled) */
const INLINE_RULE_SYMBOL = Symbol.for("react-native-css.inline-rule");
const VARS_SYMBOL = Symbol.for("react-native-css.vars");

/**
 * Deep-strip styled markers from a style value:
 * - inline-rule markers ({[INLINE_RULE_SYMBOL]: classNames}) are dropped,
 *   their classNames collected
 * - vars() markers ({[VARS_SYMBOL]: "inline", ...decls}) are dropped, their
 *   declarations collected (leading -- stripped)
 * Only literal values survive — upstream rightIsInline semantics.
 */
export function stripStyleMarkers(
  value: unknown,
  collected: { classNames: string[]; variables: Record<string, any> },
): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripStyleMarkers(item, collected))
      .filter((item) => item !== undefined);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<PropertyKey, unknown>;

    if (VARS_SYMBOL in record) {
      for (const [key, v] of Object.entries(record)) {
        if (key !== String(VARS_SYMBOL)) {
          const bare = key.startsWith("--") ? key.slice(2) : key;
          collected.variables[bare] = v;
        }
      }
      return undefined;
    }

    const inline = record[INLINE_RULE_SYMBOL];
    if (typeof inline === "string") {
      collected.classNames.push(...inline.split(/\s+/).filter(Boolean));
      return undefined;
    }

    const cleaned: Record<string, any> = {};
    for (const [key, v] of Object.entries(record)) {
      const cleanedValue = stripStyleMarkers(v, collected);
      if (cleanedValue !== undefined) {
        cleaned[key] = cleanedValue;
      }
    }
    return cleaned;
  }
  return value;
}
