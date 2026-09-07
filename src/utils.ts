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

export function getDeepKeys(obj: unknown, keys = new Set<string>()): string[] {
  if (typeof obj !== "object" || !obj) {
    return [];
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      getDeepKeys(item, keys);
    }
  } else {
    for (const key of Object.keys(obj)) {
      keys.add(key);
      getDeepKeys((obj as Record<string, unknown>)[key], keys);
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
export function mergeStylesWithInline(
  userStyle: any,
  styled: { style?: any; importantStyle?: any },
): any {
  const classNameLayers = [
    ...(Array.isArray(styled.style) ? styled.style : [styled.style]),
    ...(Array.isArray(styled.importantStyle)
      ? styled.importantStyle
      : [styled.importantStyle]),
  ].filter(Boolean);

  if (classNameLayers.length === 0) {
    return userStyle;
  }

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

  const inlineLayers = Array.isArray(userStyle) ? userStyle : [userStyle];
  const hasInline = inlineLayers.some(Boolean);

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
