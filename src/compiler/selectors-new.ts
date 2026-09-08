import type { Selector, SelectorComponent, SelectorList } from "lightningcss";
import type { AnyMap } from "react-native-nitro-modules";

import { Specificity } from "../native/specificity";
import type {
  AttributeQueryRule,
  AttrSelectorOperator,
  HybridContainerQuery,
  SpecificityArray,
} from "../specs/StyleRegistry/HybridStyleRegistry.nitro";

export type { AttributeQueryRule };
import type { CompilerOptions } from "./compiler.types";

interface PseudoClass {
  a?: boolean; // active
  f?: boolean; // focus
  h?: boolean; // hover
}

export type NormalizedSelector = ClassNameSelector | VariableSelector;

interface ClassNameSelector {
  type: "className";
  specificity: SpecificityArray;
  className: string;
  mediaQuery?: AnyMap[];
  containerQuery?: HybridContainerQuery[];
  pseudoClassesQuery?: PseudoClass;
  attributeQuery?: AttributeQueryRule[];
}

interface VariableSelector {
  type: "rootVariables" | "universalVariables";
  subtype: "light" | "dark";
}

/**
 * Parses a CSS selector list into normalized selectors for react-native-css
 */
export class SelectorParser {
  private readonly options: CompilerOptions;

  constructor(options: CompilerOptions) {
    this.options = options;
  }

  parse(selectorList: SelectorList): NormalizedSelector[] {
    const results: NormalizedSelector[] = [];

    for (const cssSelector of selectorList) {
      const normalized = this.parseSelector(cssSelector);
      if (normalized) {
        results.push(normalized);
      }
    }

    return results;
  }

  private parseSelector(selector: Selector): NormalizedSelector | null {
    // Handle :is() and :where() pseudo-classes
    if (this.isIsPseudoClass(selector) || this.isWherePseudoClass(selector)) {
      // Dark-mode class: `<sel>:is(.dark *)` — the dark class lives on the
      // app root, so compile to a color-scheme condition on <sel> (upstream
      // design, commented out in their selectors.ts)
      if (this.options.darkMode && this.isDarkAncestorIs(selector)) {
        return this.parseDarkDescendant(selector);
      }
      const results = this.parse(selector[0].selectors);
      return results[0] ?? null;
    }

    // Handle variable selectors
    const variableSelector = this.parseVariableSelector(selector);
    if (variableSelector) {
      return variableSelector;
    }

    // Handle class-based selectors
    return this.parseClassSelector(selector);
  }

  /** Matches `:is(.dark *)` where dark is the configured dark-mode class */
  private isDarkAncestorIsList(selectors: Selector[]): boolean {
    if (selectors.length !== 1) {
      return false;
    }
    // Strip combinators — `.dark *` inside :is() carries a descendant
    // combinator between the class and the universal
    const components = (selectors[0] ?? []).filter(
      (c) => c.type !== "combinator",
    );
    if (components.length !== 2) {
      return false;
    }
    return (
      components.some(
        (c) => c.type === "class" && c.name === this.options.darkMode,
      ) && components.some((c) => c.type === "universal")
    );
  }

  private isDarkAncestorIs(selector: Selector): boolean {
    const isComponent = selector.find(
      (c) => c.type === "pseudo-class" && c.kind === "is",
    );
    if (!isComponent || isComponent.type !== "pseudo-class") {
      return false;
    }
    const inner = isComponent.selectors;
    if (!inner || inner.length !== 1) {
      return false;
    }
    const components = inner[0];
    if (!components) {
      return false;
    }
    return (
      components.length === 2 &&
      components.some(
        (c) => c.type === "class" && c.name === this.options.darkMode,
      ) &&
      components.some((c) => c.type === "universal")
    );
  }

  /** Compiles `<sel>:is(.dark *)` → <sel> gated on prefers-color-scheme: dark */
  private parseDarkDescendant(selector: Selector): NormalizedSelector | null {
    const rest = selector.filter(
      (c) => !(c.type === "pseudo-class" && c.kind === "is"),
    );
    const context = new SelectorContext();
    context.setForcedMedia([{ "prefers-color-scheme": ["=", "dark"] }]);
    for (const component of [...rest].reverse()) {
      const result = this.processComponent(component, context);
      if (result === "invalid") {
        return null;
      }
    }
    return context.toClassNameSelector();
  }

  private parseVariableSelector(selector: Selector): VariableSelector | null {
    // :root {}
    if (this.isRootVariableSelector(selector)) {
      // Detect dark mode from selector
      const isDarkMode = this.hasDarkModeInSelector(selector);
      return {
        type: "rootVariables",
        subtype: isDarkMode ? "dark" : "light",
      };
    }

    // .dark:root {} or :root[class~="dark"]
    if (this.isRootDarkVariableSelector(selector)) {
      return {
        type: "rootVariables",
        subtype: "dark",
      };
    }

    // * {} with dark mode media query
    const isDarkMode = this.hasDarkModeInSelector(selector);
    if (isDarkMode && this.isDefaultVariableSelector(selector)) {
      return {
        type: "universalVariables",
        subtype: "dark",
      };
    }

    // * {}
    if (this.isDefaultVariableSelector(selector)) {
      return {
        type: "universalVariables",
        subtype: "light",
      };
    }

    return null;
  }

  private parseClassSelector(selector: Selector): ClassNameSelector | null {
    const context = new SelectorContext();

    // Process selector components in reverse order
    for (const component of [...selector].reverse()) {
      const result = this.processComponent(component, context);
      if (result === "invalid") {
        return null;
      }
    }

    return context.toClassNameSelector();
  }

  private processComponent(
    component: SelectorComponent,
    context: SelectorContext,
  ): "valid" | "invalid" {
    switch (component.type) {
      case "universal":
      case "namespace":
      case "id":
      case "pseudo-element":
        return "invalid";

      case "type":
        // The selector prefix (e.g. "html") is allowed and ignored
        if (component.name === this.options.selectorPrefix) {
          return "valid";
        }
        return "invalid";

      case "nesting":
        return "valid";

      case "class":
        return this.processClassComponent(component, context);

      case "pseudo-class":
        return this.processPseudoClassComponent(component, context);

      case "attribute":
        return this.processAttributeComponent(component, context);

      case "type":
        return this.processTypeComponent(component, context);

      case "combinator":
        return this.processCombinatorComponent(component, context);

      default:
        (component) satisfies never;
        return "invalid";
    }
  }

  private processClassComponent(
    component: Extract<SelectorComponent, { type: "class" }>,
    context: SelectorContext,
  ): "valid" | "invalid" {
    if (component.name === this.options.darkMode && context.primaryClassName) {
      // Dark-mode class as ancestor (`.dark .child`): the class lives on the
      // app root, so gate the rule on the color-scheme condition instead of
      // resolving a container
      context.setForcedMedia([{ "prefers-color-scheme": ["=", "dark"] }]);
    } else if (!context.primaryClassName) {
      context.setPrimaryClassName(component.name);
    } else if (context.isInClassBlock) {
      context.addAttributeQuery(["star", "className", component.name] as const);
    } else if (component.name !== this.options.selectorPrefix) {
      context.addContainerClass(component.name);
    }

    context.markInClassBlock();
    context.incrementSpecificity(Specificity.className);

    return "valid";
  }

  private processPseudoClassComponent(
    component: Extract<SelectorComponent, { type: "pseudo-class" }>,
    context: SelectorContext,
  ): "valid" | "invalid" {
    context.incrementSpecificity(Specificity.className);

    switch (component.kind) {
      case "hover":
        context.addPseudoClass("h", true);
        return "valid";
      case "active":
        context.addPseudoClass("a", true);
        return "valid";
      case "focus":
        context.addPseudoClass("f", true);
        return "valid";
      case "disabled":
        context.addAttributeQuery(["present", "disabled"] as const);
        return "valid";
      case "empty":
        context.addAttributeQuery(["absent", "children"] as const);
        return "valid";
      case "is": {
        // Dark-mode class: `<sel>:is(.dark *)` — the dark class lives on the
        // app root, so gate the rule on the color-scheme condition instead
        // of matching an ancestor (upstream design, left unimplemented there)
        const isDark = this.options.darkMode &&
          component.selectors?.length === 1 &&
          this.isDarkAncestorIsList(component.selectors);
        if (isDark) {
          context.setForcedMedia([{
            "prefers-color-scheme": ["=", "dark"],
          } as unknown as AnyMap]);
          return "valid";
        }
        return "invalid";
      }
      default:
        return "invalid";
    }
  }

  private processAttributeComponent(
    component: Extract<SelectorComponent, { type: "attribute" }>,
    context: SelectorContext,
  ): "valid" | "invalid" {
    context.incrementSpecificity(Specificity.className);

    const query = this.buildAttributeQuery(component);
    if (query) {
      context.addAttributeQuery(query);
      return "valid";
    }

    return "invalid";
  }

  private buildAttributeQuery(
    component: Extract<SelectorComponent, { type: "attribute" }>,
  ): AttributeQueryRule | null {
    const attributeName = component.name.startsWith("data-")
      ? toRNProperty(component.name.replace("data-", ""))
      : toRNProperty(component.name);

    if (component.operation) {
      const operator = this.mapAttributeOperator(component.operation.operator);
      if (operator && operator !== "present" && operator !== "absent") {
        return [operator, attributeName, component.operation.value] as const;
      }
    }

    // No operation means checking for attribute existence (boolean)
    return ["present", attributeName] as const;
  }

  private mapAttributeOperator(
    operator: string,
  ): AttrSelectorOperator | undefined {
    switch (operator) {
      case "equal":
        return "eq";
      case "includes":
        return "tilde";
      case "dash-match":
        return "pipe";
      case "prefix":
        return "carat";
      case "substring":
        return "star";
      case "suffix":
        return "dollar";
      default:
        return undefined;
    }
  }

  private processTypeComponent(
    component: Extract<SelectorComponent, { type: "type" }>,
    _context: SelectorContext,
  ): "valid" | "invalid" {
    // Only allow type selectors that match the selector prefix (e.g., "html")
    if (component.name === this.options.selectorPrefix) {
      return "valid";
    }
    return "invalid";
  }

  private processCombinatorComponent(
    component: Extract<SelectorComponent, { type: "combinator" }>,
    context: SelectorContext,
  ): "valid" | "invalid" {
    // Only support descendant combinator
    if (component.value === "descendant") {
      context.startNewBlock();
      return "valid";
    }
    return "invalid";
  }

  // Helper methods for selector type checking
  private isIsPseudoClass(
    selector: Selector,
  ): selector is [{ type: "pseudo-class"; kind: "is"; selectors: Selector[] }] {
    return (
      selector.length === 1 &&
      selector[0]?.type === "pseudo-class" &&
      selector[0].kind === "is"
    );
  }

  private isWherePseudoClass(
    selector: Selector,
  ): selector is [
    { type: "pseudo-class"; kind: "where"; selectors: Selector[] },
  ] {
    return (
      selector.length === 1 &&
      selector[0]?.type === "pseudo-class" &&
      selector[0].kind === "where"
    );
  }

  private isRootVariableSelector(selector: Selector): boolean {
    const [first, second] = selector;
    return (
      !!first &&
      !second &&
      first.type === "pseudo-class" &&
      first.kind === "root"
    );
  }

  private isDefaultVariableSelector(selector: Selector): boolean {
    const [first, second] = selector;
    return !!first && !second && first.type === "universal";
  }

  private isRootDarkVariableSelector(selector: Selector): boolean {
    const [first, second] = selector;
    if (!first || !second) return false;

    // .dark:root {}
    if (
      first.type === "class" &&
      second.type === "pseudo-class" &&
      second.kind === "root"
    ) {
      return true;
    }

    // :root[class~=dark] {}
    if (
      first.type === "pseudo-class" &&
      first.kind === "root" &&
      second.type === "attribute" &&
      second.name === "class" &&
      second.operation &&
      ["includes", "equal"].includes(second.operation.operator)
    ) {
      return true;
    }

    return false;
  }

  private hasDarkModeInSelector(selector: Selector): boolean {
    // Check if selector contains .dark class or dark attribute
    for (const component of selector) {
      if (component.type === "class" && component.name === "dark") {
        return true;
      }
      if (
        component.type === "attribute" &&
        component.name === "class" &&
        component.operation?.value === "dark"
      ) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Maintains state while parsing a single selector
 */
class SelectorContext {
  primaryClassName?: string;
  isInClassBlock = false;
  private newBlock = false;
  private readonly specificity: SpecificityArray = [0, 0, 0, 0, 0];
  private mediaQuery?: AnyMap[];
  /** Dark-mode class conditions compiled into a color-scheme media query */
  private forcedMedia?: AnyMap[];

  setForcedMedia(media: AnyMap[]) {
    this.forcedMedia = media;
  }
  private containerQuery?: HybridContainerQuery[];
  private attributeQuery?: AttributeQueryRule[];
  private pseudoClassesQuery?: PseudoClass;
  private currentContainerQuery?: HybridContainerQuery;

  setPrimaryClassName(name: string) {
    this.primaryClassName = name;
  }

  markInClassBlock() {
    this.isInClassBlock = true;
    this.newBlock = false;
  }

  startNewBlock() {
    this.isInClassBlock = false;
    this.newBlock = true;
    this.currentContainerQuery = undefined;
  }

  incrementSpecificity(index: number) {
    this.specificity[index] = (this.specificity[index] ?? 0) + 1;
  }

  addPseudoClass(key: "a" | "f" | "h", value: boolean) {
    const target = this.getPseudoClassTarget();
    target[key] = value;
  }

  addAttributeQuery(rule: AttributeQueryRule) {
    // For now, store all as regular attribute rules
    this.attributeQuery ??= [];
    this.attributeQuery.push(rule);
  }

  addContainerClass(name: string) {
    if (this.currentContainerQuery?.n) {
      // Already have a container name, add as attribute query
      this.addAttributeQuery(["star", "className", name] as const);
    } else {
      // Create new container query
      this.currentContainerQuery ??= {};
      this.currentContainerQuery.n = name;
      this.containerQuery ??= [];
      this.containerQuery.unshift(this.currentContainerQuery);
    }
  }

  toClassNameSelector(): ClassNameSelector | null {
    if (!this.primaryClassName) {
      return null;
    }

    return {
      type: "className",
      specificity: this.specificity,
      className: this.primaryClassName,
      mediaQuery: this.forcedMedia ?? this.mediaQuery,
      containerQuery: this.containerQuery,
      pseudoClassesQuery: this.pseudoClassesQuery,
      attributeQuery: this.attributeQuery,
    };
  }

  private getPseudoClassTarget(): PseudoClass {
    if (this.newBlock) {
      this.currentContainerQuery ??= {};
    }

    if (this.currentContainerQuery) {
      this.currentContainerQuery.p ??= {};
      return this.currentContainerQuery.p;
    }

    this.pseudoClassesQuery ??= {};
    return this.pseudoClassesQuery;
  }
}

export function toRNProperty<T extends string>(str: T): CamelCase<T> {
  return str
    .replace(/^-rn-/, "")
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "") as CamelCase<T>;
}

type CamelCase<S extends string> =
  S extends `${infer P1}-${infer P2}${infer P3}`
    ? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
    : Lowercase<S>;
