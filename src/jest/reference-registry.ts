/**
 * A JS reference implementation of the StyleRegistry API for tests.
 *
 * It mirrors the C++ pipeline in cpp/StyledComputedFactory.cpp (rule
 * collection, specificity sorting, first-wins merging, important handling,
 * value resolution) so upstream's behavioral test suite can run in jest.
 *
 * This is a TEST DOUBLE, not a second runtime: verified semantics live in
 * the C++ doctest suite (`yarn test:native`) and on-device e2e. Known
 * simplifications vs the C++:
 * - container queries are treated as passing (no layout loop in jest)
 * - media queries support width/height min/max and prefers-color-scheme
 * - fn resolution covers var() and marker units; math functions are owned
 *   by the doctests
 */
import { to as convert, mix, parse } from "colorjs.io/fn";
import type { AnyMap, ValueType } from "react-native-nitro-modules";

import { testAttributeQuery } from "../native/attributeQuery";
import type {
  Declarations,
  HybridStyleRule,
  HybridStyleSheet,
  PseudoClassType,
  Styled,
} from "../specs/StyleRegistry";

type AnyValue = ValueType;
type VariableMap = Map<string, AnyValue>;

interface ComponentState {
  active?: boolean;
  hover?: boolean;
  focus?: boolean;
}

function splitClassNames(classNames: string): string[] {
  return classNames.split(/\s+/).filter((name) => name !== "");
}

export class ReferenceRegistry {
  private styleRuleMap = new Map<string, HybridStyleRule[]>();
  private rootVariables: VariableMap = new Map([
    // Upstream seeds the root color with the platform label color so
    // currentcolor resolves before any author color is set
    [
      "__rn-css-color",
      [
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("react-native").PlatformColor("label", "labelColor"),
      ],
    ],
  ]);
  private universalVariables: VariableMap = new Map();
  private scopedVariables = new Map<string, VariableMap>();
  private keyframes = new Map<string, AnyValue>();
  private window = { width: 0, height: 0, scale: 1, fontScale: 1 };
  private colorScheme: "light" | "dark" | null = null;
  private componentStates = new Map<string, ComponentState>();
  private componentVars = new Map<string, Record<string, AnyValue>>();
  private layouts = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  private componentValidAqs = new Map<string, Set<string>>();
  private scopeDependents = new Map<string, Set<string>>();
  private referencedContainers = new Set<string>();
  private componentAttributes = new Map<string, Record<string, unknown>>();
  private containerScopes = new Map<
    string,
    { parent: string; names: Set<string> }
  >();

  private rerenders = new Map<string, () => void>();

  /** Harness hook: Appearance color scheme */
  setColorScheme(scheme: "light" | "dark" | null): void {
    this.colorScheme = scheme;
    this.notifyAll();
  }

  /** Harness hook: partial window-dimension update */
  setDimensions(
    partial: Partial<{
      width: number;
      height: number;
      scale: number;
      fontScale: number;
    }>,
  ): void {
    this.window = { ...this.window, ...partial };
    // The C++ registry re-resolves via env observables; fan out manually
    this.notifyAll();
  }

  /** Reset all state (jest beforeEach) */
  reset(): void {
    this.styleRuleMap.clear();
    this.rootVariables.clear();
    // Re-seed the platform label color (upstream native-internal/root.ts)
    this.rootVariables.set("__rn-css-color", [
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react-native").PlatformColor("label", "labelColor"),
    ]);
    this.universalVariables.clear();
    this.scopedVariables.clear();
    this.keyframes.clear();
    this.componentStates.clear();
    this.componentVars.clear();
    this.layouts.clear();
    this.containerScopes.clear();
    this.componentValidAqs.clear();
    this.scopeDependents.clear();
    this.referencedContainers.clear();
    this.componentAttributes.clear();
    this.rerenders.clear();
    this.window = { width: 0, height: 0, scale: 1, fontScale: 1 };
    this.colorScheme = null;
  }

  // –
  // StyleRegistryApi
  // –

  private notifyAll(): void {
    for (const rerender of this.rerenders.values()) {
      rerender();
    }
  }

  setClassname(className: string, styleRule: HybridStyleRule[]): void {
    this.styleRuleMap.set(className, styleRule);
    this.notifyAll();
  }

  addStyleSheet(stylesheet: HybridStyleSheet): void {
    if (stylesheet.s) {
      for (const [className, rules] of Object.entries(stylesheet.s)) {
        this.setClassname(className, rules);
      }
      // Index which class names appear as container-query targets — a
      // component carrying such a class is a group container even when it
      // has no rules of its own (e.g. `.my-a.my-b .child` → cq n "my-b")
      for (const rules of Object.values(stylesheet.s)) {
        for (const rule of rules) {
          for (const cq of rule.cq ?? []) {
            if (cq.n) {
              this.referencedContainers.add(cq.n);
            }
          }
        }
      }
    }
    if (stylesheet.r !== undefined) {
      this.rootVariables.set("__rn-css-rem", stylesheet.r);
    }
    if (stylesheet.vr) {
      for (const [name, value] of Object.entries(stylesheet.vr)) {
        this.rootVariables.set(name, value);
      }
    }
    if (stylesheet.vu) {
      for (const [name, value] of Object.entries(stylesheet.vu)) {
        this.universalVariables.set(name, value);
      }
    }
    this.notifyAll();
  }

  setRootVariables(variables: AnyMap): void {
    for (const [name, value] of Object.entries(variables)) {
      this.rootVariables.set(name, value);
    }
  }

  setUniversalVariables(variables: AnyMap): void {
    for (const [name, value] of Object.entries(variables)) {
      this.universalVariables.set(name, value);
    }
  }

  setKeyframes(name: string, keyframes: AnyMap): void {
    this.keyframes.set(name, keyframes);
  }

  setWindowDimensions(
    width: number,
    height: number,
    scale: number,
    fontScale: number,
  ): void {
    this.window = { width, height, scale, fontScale };
  }

  getDeclarations(
    componentId: string,
    classNames: string,
    variableScope: string,
    containerScope: string,
  ): Declarations {
    const declarations: Declarations = { variableScope };
    const attributeQueries: [string, NonNullable<HybridStyleRule["aq"]>][] = [];
    const containerNames = new Set<string>();
    let hasContainers = false;

    for (const className of splitClassNames(classNames)) {
      // Group selectors: the class is referenced as a container-query target
      // anywhere in the stylesheet (covers group/item, plain descendant
      // selectors, and bare "group") — checked before the rules lookup so
      // marker-only group classes register too
      if (this.referencedContainers.has(className)) {
        containerNames.add(className);
        hasContainers = true;
      }
      const rules = this.styleRuleMap.get(className);
      if (!rules) {
        continue;
      }
      for (const rule of rules) {
        if (rule.aq && rule.id) {
          attributeQueries.push([rule.id, rule.aq]);
        }
        // Container names declared by this component (container-type)
        if (rule.c) {
          for (const name of rule.c) {
            containerNames.add(name);
            hasContainers = true;
          }
        }
        if (rule.v) {
          // Components with variables get their own scope; children inherit
          // it through the VariableContext provider chain (C++ parity)
          declarations.variableScope = componentId;
        }
        if (rule.pq) {
          if (rule.pq.a) {
            declarations.active = true;
          }
          if (rule.pq.f) {
            declarations.focus = true;
          }
          if (rule.pq.h) {
            declarations.hover = true;
          }
        }
      }
    }

    // Register as a named container; children inherit the scope through the
    // ContainerContext provider chain (C++ parity)
    if (hasContainers) {
      this.containerScopes.set(componentId, {
        parent: containerScope,
        names: containerNames,
      });
      declarations.containerScope = componentId;
    }

    if (attributeQueries.length > 0) {
      declarations.attributeQueries = attributeQueries;
    }
    return declarations;
  }

  registerComponent(
    componentId: string,
    rerender: () => void,
    classNames: string,
    variableScope: string,
    containerScope: string,
    validAttributeQueries: string[],
  ): Styled {
    this.rerenders.set(componentId, rerender);
    const prevAqIds = this.componentValidAqs.get(componentId);
    const nextAqIds = new Set(validAttributeQueries);
    const aqChanged =
      !prevAqIds ||
      prevAqIds.size !== nextAqIds.size ||
      [...nextAqIds].some((id) => !prevAqIds.has(id));
    this.componentValidAqs.set(componentId, nextAqIds);
    if (aqChanged) {
      // Attribute-query validity changed — dependents (group children)
      // re-evaluate their rules against the fresh attributes
      this.notifyAll();
    }
    if (containerScope && containerScope !== componentId) {
      const deps = this.scopeDependents.get(containerScope) ?? new Set();
      deps.add(componentId);
      this.scopeDependents.set(containerScope, deps);
    }

    // Collect rules from all classNames that pass their conditions
    // (container scopes are registered by getDeclarations, called before this)
    const allRules: HybridStyleRule[] = [];
    for (const className of splitClassNames(classNames)) {
      const rules = this.styleRuleMap.get(className);
      if (!rules) {
        continue;
      }
      for (const rule of rules) {
        if (
          this.testRule(
            rule,
            componentId,
            containerScope,
            validAttributeQueries,
          )
        ) {
          allRules.push(rule);
        }
      }
    }

    // Highest specificity first; first-wins on merge
    allRules.sort((a, b) => {
      for (let i = 0; i < 5; i++) {
        const ai = a.s[i] ?? 0;
        const bi = b.s[i] ?? 0;
        if (ai !== bi) {
          return bi - ai;
        }
      }
      return 0;
    });

    // Inline variables — notify dependents only when a value actually
    // changes (memoized children rely on own-state rerenders)
    // Mounting components render with their variables applied — no notify
    // (a notify here would dispatch during React's render phase)
    const isMount = !this.rerenders.has(componentId);

    // Notify dependents only when the scope's variables actually changed
    // during application (per-rule checks oscillate when multiple rules
    // write the same variable).
    const scopeSnapshot = () =>
      JSON.stringify(
        Object.fromEntries(
          this.scopedVariables.get(variableScope)?.entries() ?? [],
        ),
      );
    const before = scopeSnapshot();

    for (const rule of allRules) {
      if (rule.v) {
        for (const [name, value] of Object.entries(rule.v)) {
          this.setVariable(variableScope, name, value);
        }
      }
    }

    // vars() inline variables (component-scoped, override rule variables)
    const componentVars = this.componentVars.get(componentId);
    if (componentVars) {
      for (const [name, value] of Object.entries(componentVars)) {
        this.setVariable(variableScope, name, value);
      }
    }

    if (scopeSnapshot() !== before) {
      if (this.renderPaused) {
        // Render-phase change: flush after the commit (see useStyled)
        this.pendingNotify = true;
      } else if (!isMount) {
        this.notifyAll();
      }
    }

    // Merge declarations/props, first-wins, important rules (s[0] > 0)
    // split into their own targets — mirrors StyledComputedFactory
    const style: Record<string, AnyValue> = {};
    const importantStyle: Record<string, AnyValue> = {};
    const props: Record<string, AnyValue> = {};
    const importantProps: Record<string, AnyValue> = {};

    for (const rule of allRules) {
      const isImportant = rule.s[0] > 0;
      if (rule.d) {
        const target = isImportant ? importantStyle : style;
        this.mergeDeclarations(rule.d, target, variableScope);
      }
      if (rule.p) {
        const target = isImportant ? importantProps : props;
        this.mergeDeclarations(rule.p, target, variableScope);
      }
    }

    this.aggregateTransforms(style);
    this.aggregateTransforms(importantStyle);

    const styled: Styled = {};
    if (Object.keys(style).length > 0) {
      styled.style = style;
    }
    if (Object.keys(importantStyle).length > 0) {
      styled.importantStyle = importantStyle;
    }
    if (Object.keys(props).length > 0) {
      styled.props = props;
    }
    if (Object.keys(importantProps).length > 0) {
      styled.importantProps = importantProps;
    }
    void containerScope; // container queries pass in the reference impl
    return styled;
  }

  deregisterComponent(componentId: string): void {
    this.rerenders.delete(componentId);
    this.componentStates.delete(componentId);
  }

  updateComponentAttributes(
    componentId: string,
    attributes: Record<string, unknown>,
  ): void {
    // Attribute queries only read className/disabled — notify dependents
    // when those change so group children re-evaluate
    const prev = this.componentAttributes.get(componentId);
    this.componentAttributes.set(componentId, attributes);
    if (
      prev &&
      (prev.className !== attributes.className ||
        prev.disabled !== attributes.disabled)
    ) {
      this.notifyAll();
    }
  }

  updateComponentState(
    componentId: string,
    type: PseudoClassType,
    value: boolean,
  ): void {
    const state = this.componentStates.get(componentId) ?? {};
    state[type] = value;
    this.componentStates.set(componentId, state);
    // Recompute synchronously, then notify the component and its group
    // dependents (children whose rules reference this component's state)
    this.rerenders.get(componentId)?.();
    for (const dep of this.scopeDependents.get(componentId) ?? []) {
      this.rerenders.get(dep)?.();
    }
  }

  updateComponentLayout(
    componentId: string,
    value: { x: number; y: number; width: number; height: number },
  ): void {
    this.layouts.set(componentId, { ...value });
    this.notifyAll();
  }

  updateComponentInlineVariables(
    componentId: string,
    variables: Record<string, AnyValue>,
  ): void {
    const next = { ...variables };
    const prev = this.componentVars.get(componentId);
    // Only notify on real changes — the caller's effect runs every render
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      this.componentVars.set(componentId, next);
      this.notifyAll();
    }
  }

  updateComponentInlineStyleKeys(_componentId: string, _keys: string[]): void {
    // Inline-style interplay is verified against the C++ registry on device
  }

  linkComponent(_componentId: string, _tag: number): void {
    // Shadow-tree updates don't exist in the reference impl
  }

  unlinkComponent(_componentId: string): void {
    // no-op
  }

  registerExternalMethods(_options: unknown): void {
    // no-op
  }

  // –
  // Internals
  // –

  private testRule(
    rule: HybridStyleRule,
    componentId: string,
    containerScope: string,
    validAttributeQueries: string[],
  ): boolean {
    if (rule.aq) {
      if (rule.id && validAttributeQueries.includes(rule.id)) {
        // Own-attribute query, already validated by useStyledProps
      } else if (
        rule.id &&
        containerScope !== componentId &&
        containerScope !== "root" &&
        testAttributeQuery(
          this.componentAttributes.get(containerScope) ?? {},
          rule.aq,
          false,
        )
      ) {
        // Group-attribute query (`.a.b .c`): evaluated against the group
        // container's attributes
      } else {
        return false;
      }
    }
    if (rule.pq) {
      const state = this.componentStates.get(componentId) ?? {};
      if (rule.pq.a && !state.active) {
        return false;
      }
      if (rule.pq.h && !state.hover) {
        return false;
      }
      if (rule.pq.f && !state.focus) {
        return false;
      }
    }
    if (rule.mq && !this.testMedia(rule.mq)) {
      return false;
    }
    if (rule.cq) {
      for (const cq of rule.cq) {
        const pass = this.testContainerQuery(cq, containerScope);
        if (process.env.NW_TRACE) {
          console.log(
            "CQ test:",
            JSON.stringify(cq),
            "scope:",
            containerScope,
            "→",
            pass,
            "| scopes:",
            JSON.stringify(
              [...this.containerScopes.entries()].map(([k, v]) => [
                k,
                [...v.names],
                v.parent,
              ]),
            ),
          );
        }
        if (!pass) {
          return false;
        }
      }
    }
    return true;
  }

  /** C++ ContainerContext::findInScope parity */
  private findInScope(
    containerScope: string,
    name?: string,
  ): string | undefined {
    if (name === undefined) {
      return containerScope;
    }
    const scope = this.containerScopes.get(containerScope);
    if (!scope) {
      return undefined;
    }
    if (scope.names.has(name)) {
      return containerScope;
    }
    if (scope.parent && scope.parent !== "root") {
      return this.findInScope(scope.parent, name);
    }
    return undefined;
  }

  private testContainerQuery(
    cq: NonNullable<HybridStyleRule["cq"]>[number],
    containerScope: string,
  ): boolean {
    const resolved = this.findInScope(containerScope, cq.n);
    if (resolved === undefined) {
      return false;
    }

    // Group pseudo (e.g. .group/item:active .child): check the container's
    // own interactive state, not the component's
    if (cq.p) {
      const state = this.componentStates.get(resolved) ?? {};
      if (cq.p.a && !state.active) {
        return false;
      }
      if (cq.p.h && !state.hover) {
        return false;
      }
      if (cq.p.f && !state.focus) {
        return false;
      }
    }

    if (!cq.m) {
      return true;
    }
    const layout = this.layouts.get(resolved);
    if (!layout) {
      return false;
    }

    const keys = Object.keys(cq.m).filter((k) => k !== "$$op");
    if (keys.length === 0) {
      return true;
    }
    for (const feature of keys) {
      const condition = cq.m[feature];
      if (!Array.isArray(condition) || condition.length < 2) {
        return false;
      }
      const [op, expected] = condition;
      if (typeof op !== "string" || typeof expected !== "number") {
        return false;
      }
      const actual =
        feature === "width"
          ? layout.width
          : feature === "height"
            ? layout.height
            : undefined;
      if (actual === undefined) {
        return false;
      }
      const pass =
        op === "=" || op === "eq"
          ? actual === expected
          : op === ">" || op === "gt"
            ? actual > expected
            : op === ">=" || op === "gte"
              ? actual >= expected
              : op === "<" || op === "lt"
                ? actual < expected
                : op === "<=" || op === "lte"
                  ? actual <= expected
                  : false;
      if (!pass) {
        return false;
      }
    }
    return true;
  }

  private testMedia(mq: Record<string, AnyValue>): boolean {
    const keys = Object.keys(mq);
    if (keys.length === 0) {
      return true;
    }

    let logicOp = "and";
    let negate = false;
    const op = mq.$$op;
    if (typeof op === "string") {
      logicOp = op;
      if (op === "not") {
        negate = true;
        logicOp = "and";
      }
    }

    const results: boolean[] = [];
    for (const key of keys) {
      if (key === "$$op") {
        continue;
      }

      // Nested logic conditions: {and: [...]}, {or: [...]}, {not: {...}}
      if (key === "and" || key === "or" || key === "not") {
        const nested = mq[key];
        if (Array.isArray(nested)) {
          const sub = nested.map((c) =>
            this.testMedia(c as Record<string, AnyValue>),
          );
          const subResult =
            key === "or" ? sub.some(Boolean) : sub.every(Boolean);
          results.push(key === "not" ? !subResult : subResult);
        } else if (nested !== null && typeof nested === "object") {
          const subResult = this.testMedia(nested as Record<string, AnyValue>);
          results.push(key === "not" ? !subResult : subResult);
        }
        continue;
      }

      const condition = mq[key];
      if (!Array.isArray(condition) || condition.length < 2) {
        continue;
      }
      const [comparison, expected] = condition;
      if (typeof comparison !== "string") {
        continue;
      }
      if (expected === undefined) {
        continue;
      }
      results.push(this.testMediaFeature(key, comparison, expected));
    }

    if (results.length === 0) {
      return true;
    }
    let result =
      logicOp === "or" ? results.some(Boolean) : results.every(Boolean);
    if (negate) {
      result = !result;
    }
    return result;
  }

  private testMediaFeature(
    key: string,
    comparison: string,
    expected: AnyValue,
  ): boolean {
    if (key === "prefers-color-scheme") {
      return comparison === "=" && expected === this.colorScheme;
    }

    let actual: number | undefined;
    if (key === "min-width" || key === "max-width" || key === "width") {
      actual = this.window.width;
    } else if (
      key === "min-height" ||
      key === "max-height" ||
      key === "height"
    ) {
      actual = this.window.height;
    } else if (
      key === "resolution" ||
      key === "min-resolution" ||
      key === "max-resolution"
    ) {
      // dppx == PixelRatio.get() == window scale
      actual = this.window.scale;
    } else {
      return false;
    }

    if (typeof expected !== "number" || typeof actual !== "number") {
      return false;
    }
    switch (comparison) {
      case "eq":
      case "=":
        return key.startsWith("min")
          ? actual >= expected
          : key.startsWith("max")
            ? actual <= expected
            : actual === expected;
      case "gt":
        return actual > expected;
      case "gte":
        return actual >= expected;
      case "lt":
        return actual < expected;
      case "lte":
        return actual <= expected;
      default:
        return false;
    }
  }

  /** Shorthand declarations whose resolved object spreads into the style */
  private static readonly SHORTHAND_SPREAD: Record<string, true> = {
    textShadow: true,
  };

  private mergeDeclarations(
    declarations: Record<string, AnyValue>,
    target: Record<string, AnyValue>,
    variableScope: string,
  ): void {
    for (const [key, value] of Object.entries(declarations)) {
      if (key in target) {
        continue;
      }
      const resolved = this.resolveValue(value, variableScope);
      if (resolved === (undefined as unknown as AnyValue)) {
        continue;
      }
      // null (unset/cleared) keeps the key with an undefined value
      if (resolved === null) {
        // RN styles treat undefined values as absent — the key must exist
        target[key] = undefined as unknown as AnyValue;
      } else if (
        key in ReferenceRegistry.SHORTHAND_SPREAD &&
        (resolved as unknown) !== null &&
        typeof resolved === "object" &&
        !Array.isArray(resolved)
      ) {
        // Shorthands like textShadow resolve to {textShadowColor, ...} —
        // spread into the style (upstream's shorthandObject semantics)
        Object.assign(target, resolved);
      } else {
        target[key] = resolved;
      }
    }
  }

  /** Mirror of StyleResolver::applyStyleMapping's transform aggregation */
  private aggregateTransforms(style: Record<string, AnyValue>): void {
    const transformProps = new Set([
      "translateX",
      "translateY",
      "translateZ",
      "rotate",
      "rotateX",
      "rotateY",
      "rotateZ",
      "scaleX",
      "scaleY",
      "scaleZ",
      "skewX",
      "skewY",
      "perspective",
    ]);
    const transform: Record<string, AnyValue>[] = [];
    for (const key of Object.keys(style)) {
      if (!transformProps.has(key)) {
        continue;
      }
      const value = style[key];
      if (value === undefined) {
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete style[key];
      const existing = transform.find((t) => key in t);
      if (existing) {
        existing[key] = value;
      } else {
        transform.push({ [key]: value });
      }
    }
    if (transform.length > 0) {
      style.transform = transform;
    }
  }

  /** Mirror of StyleResolver::resolveStyle for the supported subset */
  private resolveValue(value: AnyValue, variableScope: string): AnyValue {
    if (Array.isArray(value)) {
      // ["fn", name, ...args]
      if (value[0] === "fn" && typeof value[1] === "string") {
        return this.resolveFn(value[1], value.slice(2), variableScope);
      }
      // [{}, kind, ...args] marker tuples
      const [marker, kind, arg] = value;
      if (
        marker !== null &&
        typeof marker === "object" &&
        Object.keys(marker).length === 0 &&
        typeof kind === "string"
      ) {
        if (kind === "var") {
          return this.resolveVar(arg as string, value[3], variableScope);
        }
        if (kind === "vw" || kind === "vh" || kind === "em" || kind === "rem") {
          if (arg === undefined) {
            return undefined as unknown as AnyValue;
          }
          return this.resolveUnit(kind, arg, variableScope);
        }
      }
      // Single-element lists around fn/marker/string values unwrap; other
      // arrays (e.g. boxShadow) are legitimate values
      if (value.length === 1 && value[0] !== undefined) {
        const inner = value[0];
        if (
          Array.isArray(inner) ||
          (typeof inner === "string" && inner !== "unset")
        ) {
          return this.resolveValue(inner, variableScope);
        }
        // "unset" wrapped in a list still means unset
        if (inner === "unset") {
          return null;
        }
      }
    }
    if (value === "unset") {
      return null;
    }
    return value;
  }

  private resolveFn(
    name: string,
    args: AnyValue[],
    variableScope: string,
  ): AnyValue {
    if (name === "var") {
      const varName = args[0];
      if (typeof varName !== "string") {
        return undefined as unknown as AnyValue;
      }
      return this.resolveVar(varName, args[1], variableScope);
    }
    if (name === "dropShadow") {
      // ["fn", "dropShadow", <resolved var tokens>] — the var holds the
      // whitespace-separated shadow tokens (offsetX offsetY blur? color?)
      // Tailwind v4 emits filter: var(--tw-drop-shadow) with
      // --tw-drop-shadow: drop-shadow(...) — nested dropShadow fn args pass
      // through as the inner structure
      // Resolve var() references inside the arguments first — the variable
      // holds the whitespace-separated shadow tokens. The compiler flattens
      // nested fn tuples, so drop-shadow(var(--x)) arrives as
      // ["fn","dropShadow","fn","var","x"] — rebuild the var reference.
      let resolvedArgs: AnyValue[] = args;
      if (
        args[0] === "fn" &&
        args[1] === "var" &&
        typeof args[2] === "string"
      ) {
        resolvedArgs = [
          this.resolveValue(["fn", "var", args[2]], variableScope),
        ];
      }
      const parts: AnyValue[] = resolvedArgs.map((arg) =>
        this.resolveValue(arg, variableScope),
      );

      const tokens: AnyValue[] = parts.flatMap((p) => {
        if (Array.isArray(p)) {
          // Resolve nested marker tuples (currentcolor → PlatformColor)
          return p.map((t) =>
            Array.isArray(t) ? this.resolveValue(t, variableScope) : t,
          );
        }
        if (typeof p === "object" && p !== null) {
          // PlatformColor / resolved color object — a color token on its own
          return [p];
        }
        return String(p).split(/\s+/).filter(Boolean);
      });
      // Tokens are space-separated: [offsetX, offsetY, blur?, color?]
      // Color may come first. Lengths are px numbers, color is a string.
      const nums: number[] = [];
      let pendingColor = "";
      let hasColor = false;
      for (const token of tokens) {
        if (typeof token === "number") {
          nums.push(token);
        } else if (typeof token === "object" && token !== null) {
          // PlatformColor / resolved color object
          pendingColor = token as unknown as string;
          hasColor = true;
        } else if (typeof token === "string" && token !== "inset") {
          pendingColor = token;
          hasColor = true;
        }
      }

      const color = hasColor ? pendingColor : "#000000";
      const [offsetX = 0, offsetY = 0, standardDeviation = 0] = nums;
      // filter is a list of filter functions — keep the array shape
      return [{ dropShadow: { offsetX, offsetY, standardDeviation, color } }];
    }
    if (name === "textShadow") {
      // ["fn", "textShadow", <resolved var tokens>] — the variable holds the
      // whitespace-separated shadow tokens. Upstream matches these patterns
      // (shorthands/text-shadow.ts): [w,h,blur,color], [color,w,h,blur],
      // [w,h,color], [color,w,h], [w,h].
      const parts: AnyValue[] = args.map((arg) =>
        this.resolveValue(arg, variableScope),
      );

      const tokens: AnyValue[] = parts.flatMap((p) => {
        if (Array.isArray(p)) {
          // Resolve nested marker tuples (currentcolor → PlatformColor)
          return p.map((t) =>
            Array.isArray(t) ? this.resolveValue(t, variableScope) : t,
          );
        }
        if (typeof p === "object" && p !== null) {
          return [p];
        }
        return String(p).split(/\s+/).filter(Boolean);
      });

      const isColor = (t: AnyValue | undefined) =>
        typeof t === "string" || (typeof t === "object" && t !== null);
      const num = (t: AnyValue | undefined) =>
        typeof t === "number"
          ? t
          : typeof t === "string"
            ? parseFloat(t) || 0
            : 0;

      let width = 0;
      let height = 0;
      let blur: AnyValue = 0;
      let color: AnyValue | undefined;

      if (tokens.length >= 2) {
        if (isColor(tokens[0])) {
          // [color, w, h, (blur)]
          color = tokens[0];
          width = num(tokens[1]);
          height = num(tokens[2]);
          blur = tokens[3] ?? 0;
        } else {
          // [w, h] / [w, h, blur] / [w, h, blur, color]
          width = num(tokens[0]);
          height = num(tokens[1]);
          if (tokens[2] !== undefined && !isColor(tokens[2])) {
            blur = tokens[2];
          }
          if (tokens[3] !== undefined && isColor(tokens[3])) {
            color = tokens[3];
          } else if (tokens[2] !== undefined && isColor(tokens[2])) {
            color = tokens[2];
          }
        }
      }

      if (color === undefined) {
        // Default color is currentcolor → the platform label color
        color = this.resolveVar("__rn-css-color", undefined, variableScope);
      }

      return {
        textShadowColor: color,
        textShadowOffset: { width, height },
        textShadowRadius: blur,
      };
    }
    if (name === "colorMix") {
      // ["fn","colorMix", space, left, leftPct?, right?, rightPct?] — the
      // compiler folds a `transparent` right side into the 3-arg form
      const resolved = args.map((arg) => this.resolveValue(arg, variableScope));
      const [space, left, leftPct, right, rightPct] = resolved;

      if (typeof space !== "string" || typeof left !== "string") {
        return undefined as unknown as AnyValue;
      }

      try {
        const parsed = parse(left);
        if (right === undefined || right === null) {
          // Single color with alpha — convert to sRGB and serialize
          parsed.alpha =
            typeof leftPct === "string" && leftPct.endsWith("%")
              ? parseFloat(leftPct) / 100
              : (parsed.alpha ?? 1);
          const srgb =
            parsed.spaceId !== "srgb" ? convert(parsed, "srgb") : parsed;
          return `rgba(${(srgb.coords[0] ?? 0) * 255}, ${(srgb.coords[1] ?? 0) * 255}, ${(srgb.coords[2] ?? 0) * 255}, ${srgb.alpha})`;
        }
        if (typeof right !== "string") {
          return undefined as unknown as AnyValue;
        }
        const rightColor = parse(right);
        if (typeof rightPct === "string" && rightPct.endsWith("%")) {
          rightColor.alpha = parseFloat(rightPct) / 100;
        }
        const result = mix(parsed, rightColor, {
          space,
          outputSpace: "srgb",
        });
        return `rgba(${(result.coords[0] ?? 0) * 255}, ${(result.coords[1] ?? 0) * 255}, ${(result.coords[2] ?? 0) * 255}, ${result.alpha})`;
      } catch {
        return undefined as unknown as AnyValue;
      }
    }
    if (name === "boxShadow" && args.length >= 1) {
      // ["fn", "boxShadow", parts...] — parts are (possibly nested) lists of
      // ["inset"?, x, y, blur, spread?, color?]; transparent shadows filtered
      const shadows: Record<string, AnyValue>[] = [];

      const isTransparent = (c: string) =>
        c === "transparent" ||
        (c.length === 5 && c.slice(3) === "00") ||
        (c.length === 9 && c.slice(7) === "00");

      const parseParts = (parts: AnyValue[], inset: boolean) => {
        let curInset = inset;
        const nums: number[] = [];
        let pendingColor = "";
        let hasPendingColor = false;

        const flush = (color: string) => {
          if (nums.length >= 3) {
            if (!isTransparent(color)) {
              const [x = 0, y = 0, blur = 0, spread] = nums;
              const shadow: Record<string, AnyValue> = {
                offsetX: x,
                offsetY: y,
                blurRadius: blur,
              };
              if (spread !== undefined) {
                shadow.spreadDistance = spread;
              }
              if (color) {
                shadow.color = color;
              }
              if (curInset) {
                shadow.inset = true;
              }
              shadows.push(shadow);
            }
            // Reset even when filtered — leftovers must not leak into the
            // next shadow
            nums.length = 0;
            curInset = false;
          }
        };

        for (const part of parts) {
          if (typeof part === "string") {
            if (part === "inset") {
              curInset = true;
            } else if (hasPendingColor || nums.length >= 3) {
              // color after lengths: closes this shadow
              flush(part);
              hasPendingColor = false;
            } else {
              // color before lengths
              pendingColor = part;
              hasPendingColor = true;
            }
          } else if (typeof part === "number") {
            nums.push(part);
          } else if (Array.isArray(part)) {
            flush(pendingColor);
            pendingColor = "";
            hasPendingColor = false;
            parseParts(part, curInset);
          }
        }
        flush(hasPendingColor ? pendingColor : "");
      };

      // Args mix: resolved var arrays, null markers for unresolved vars, and
      // flat parts from inlined variables. A null is a boundary between
      // variable groups.
      let buffer: AnyValue[] = [];
      for (const arg of args) {
        const resolved = this.resolveValue(arg, variableScope);
        if (Array.isArray(resolved)) {
          parseParts(resolved, false);
        } else if (
          resolved === (undefined as unknown as AnyValue) ||
          resolved === null
        ) {
          parseParts(buffer, false);
          buffer = [];
        } else {
          buffer.push(resolved);
        }
      }
      if (buffer.length > 0) {
        parseParts(buffer, false);
      }
      return shadows;
    }
    // Math/platform functions are owned by the C++ doctests
    return undefined as unknown as AnyValue;
  }

  private resolveVar(
    name: string,
    fallback: AnyValue | undefined,
    variableScope: string,
  ): AnyValue {
    const value = this.getVariable(variableScope, name);
    if (process.env.NW_TRACE && name === "__rn-css-color") {
      console.log(
        "RESOLVEVAR color scope:",
        variableScope,
        "→",
        JSON.stringify(value),
      );
    }
    if (value !== undefined) {
      return value;
    }
    return fallback === undefined
      ? (undefined as unknown as AnyValue)
      : this.resolveValue(fallback, variableScope);
  }

  /** Public read for useUnstableNativeVariable (no reactivity guarantees) */
  getVariableValue(scope: string, name: string): AnyValue | undefined {
    return this.getVariable(scope, name);
  }

  private getVariable(scope: string, name: string): AnyValue | undefined {
    const raw =
      this.scopedVariables.get(scope)?.get(name) ??
      this.universalVariables.get(name) ??
      this.rootVariables.get(name);
    if (raw === undefined) {
      return undefined;
    }
    // Variables may be [{v: value, m?: media}] item lists — the runtime picks
    // the first item whose media condition passes
    if (
      Array.isArray(raw) &&
      raw.every(
        (item) => item !== null && typeof item === "object" && "v" in item,
      )
    ) {
      for (const item of raw as {
        v: AnyValue;
        m?: Record<string, AnyValue>;
      }[]) {
        if (item.m === undefined || this.testMedia(item.m)) {
          // declaration values compile as single-element lists — unwrap
          return Array.isArray(item.v) && item.v.length === 1
            ? item.v[0]
            : item.v;
        }
      }
      return undefined;
    }
    // The compiler stores variable/declaration values as single-element lists
    // ([10], [["fn", …]]) — unwrap one layer; item-list variables were handled
    // above
    if (Array.isArray(raw) && raw.length === 1 && raw[0] !== undefined) {
      return raw[0];
    }

    return raw;
  }

  /** True while a component is rendering — render-phase notifies are dropped */
  private renderPaused = false;
  private pendingNotify = false;

  /** Called by the hook after commit: resume notifies and flush pending */
  resumeRender(): void {
    this.renderPaused = false;
    if (this.pendingNotify) {
      this.pendingNotify = false;
      this.notifyAll();
    }
  }

  private setVariable(scope: string, name: string, value: AnyValue): void {
    const map = (() => {
      let m = this.scopedVariables.get(scope);
      if (!m) {
        m = new Map();
        this.scopedVariables.set(scope, m);
      }
      return m;
    })();
    map.set(name, value);
  }

  private resolveUnit(
    unit: string,
    arg: AnyValue,
    variableScope: string,
  ): AnyValue {
    // line-height wraps the value in an array
    const value = Array.isArray(arg) && arg.length === 1 ? arg[0] : arg;
    if (typeof value !== "number") {
      return undefined as unknown as AnyValue;
    }

    if (unit === "vw") {
      return Math.round(this.window.width * (value / 100) * 100) / 100;
    }
    if (unit === "vh") {
      return Math.round(this.window.height * (value / 100) * 100) / 100;
    }

    const emValue =
      unit === "em"
        ? (this.getVariable(variableScope, "__rn-css-em") ??
          this.getVariable(variableScope, "__rn-css-rem"))
        : this.getVariable(variableScope, "__rn-css-rem");
    if (typeof emValue !== "number") {
      return undefined as unknown as AnyValue;
    }
    return Math.round(value * emValue * 100) / 100;
  }
}
