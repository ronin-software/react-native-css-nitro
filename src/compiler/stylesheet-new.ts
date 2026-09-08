import type {
  ContainerRule,
  Declaration,
  KeyframesRule,
  MediaRule,
  SelectorList,
} from "lightningcss";

import { Specificity } from "../native/specificity";
import type {
  HybridAnimation,
  HybridContainerQuery,
  HybridMediaQuery,
  HybridStyleRule,
  StyleSheet as HybridStyleSheet,
  SpecificityArray,
} from "../specs/StyleRegistry";
import type { AnyMap, ValueType } from "react-native-nitro-modules";
import type { CompilerOptions } from "./compiler.types";
import { getContainerQuery } from "./container-query";
import { DeclarationBuilder, parseDeclaration } from "./declarations";
import { mapMediaQueries } from "./media-query";
import {
  SelectorParser,
  type AttributeQueryRule,
  type NormalizedSelector,
} from "./selectors-new";

function createSpecificity(): SpecificityArray {
  return [0, 0, 0, 0, 0];
}

const DEFAULT_MAPPING = {
  "background-image": "experimental_backgroundImage",
};

type VariableItem = { v: ValueType; m?: AnyMap };

export class CompilerStyleSheet {
  private readonly selectorStack: NormalizedSelector[][] = [];
  private readonly mediaStack: HybridMediaQuery[][] = [];
  private readonly containerStack: HybridContainerQuery[] = [];
  private readonly mappingStack: Record<string, string>[] = [DEFAULT_MAPPING];
  private currentMapping: Record<string, string> = DEFAULT_MAPPING;

  private readonly selectorParser: SelectorParser;
  private readonly ruleSets = new Map<string, HybridStyleRule[]>();
  /** Variable items: [{v: value, m?: mediaQuery}] consumed by the runtime */
  private readonly variableSets: [
    Record<string, VariableItem[]>,
    Record<string, VariableItem[]>,
  ] = [{}, {}];
  private ruleOrder = 0;
  /** rem base declared via :root { font-size } — later rem values bake with it */
  private remBase?: number;
  private keyframes: HybridAnimation = {};

  constructor(public options: CompilerOptions) {
    this.selectorParser = new SelectorParser(options);
  }

  pushSelectors(selectors: SelectorList): boolean {
    this.ruleOrder++;
    this.selectorStack.push(this.selectorParser.parse(selectors));
    return true;
  }

  popSelectors() {
    if (!this.selectorStack.length) {
      throw new Error("No selector context to pop");
    }

    this.selectorStack.pop();
  }

  pushMediaQuery(mediaRule: MediaRule): boolean {
    const mediaQueries = mapMediaQueries(mediaRule.query.mediaQueries);
    if (mediaQueries.length === 0) {
      return false;
    }

    this.mediaStack.push(mediaQueries);
    return true;
  }

  popMediaQuery() {
    if (!this.mediaStack.length) {
      throw new Error("No media query context to pop");
    }

    this.mediaStack.pop();
  }

  pushContainerQuery(containerRule: ContainerRule): boolean {
    const containerQuery = getContainerQuery(containerRule);
    if (!containerQuery) {
      return false;
    }

    this.containerStack.push(containerQuery);
    return true;
  }

  popContainerQuery() {
    this.containerStack.pop();
  }

  pushMapping(mapping: Record<string, string>) {
    this.mappingStack.push(mapping);
    this.currentMapping = Object.assign({}, ...this.mappingStack);
  }

  popMapping() {
    this.mappingStack.pop();
    this.currentMapping = Object.assign({}, ...this.mappingStack);
  }

  addDeclarations(declarations?: Declaration[]) {
    if (!declarations || declarations.length === 0) {
      return;
    }

    const rule = new DeclarationBuilder(this.options, this.currentMapping, this.remBase);
    for (const declaration of declarations) {
      parseDeclaration(declaration, rule);
    }

    this.addRuleForSelectors(rule);
  }

  addImportantDeclarations(declarations?: Declaration[]) {
    if (!declarations || declarations.length === 0) {
      return;
    }
    const rule = new DeclarationBuilder(this.options, this.currentMapping, this.remBase);
    for (const declaration of declarations) {
      parseDeclaration(declaration, rule);
    }

    this.addRuleForSelectors(rule, { important: true });
  }

  addKeyframes(keyframes: KeyframesRule) {
    const animation: HybridAnimation = {};
    this.keyframes[keyframes.name.value] = animation;

    for (const frame of keyframes.keyframes) {
      if (!frame.declarations.declarations) continue;

      const selectors = frame.selectors.map((selector) => {
        switch (selector.type) {
          case "percentage":
            return frame.selectors.length > 1
              ? `${selector.value * 100}%`
              : selector.value;
          case "from":
          case "to":
            return selector.type;
          case "timeline-range-percentage":
            // TODO
            return frame.selectors.length > 1
              ? `${selector.value.percentage}%`
              : selector.value.percentage;
        }
      });

      const rule = new DeclarationBuilder(this.options, this.currentMapping, this.remBase);
      for (const declaration of frame.declarations.declarations) {
        parseDeclaration(declaration, rule);
      }

      // Ignore the other properties of the rule builder for keyframes
      const styles = rule.getStyle();
      if (styles) {
        animation[selectors.join(", ")] = styles;
      }
    }
  }

  private addRuleForSelectors(
    rules: DeclarationBuilder,
    options?: { important?: boolean },
  ) {
    if (this.selectorStack.length > 1) {
      throw new Error("Nested selectors are not supported at this time");
    }

    const selectors = this.selectorStack.at(0);
    if (!selectors?.length) {
      return;
    }

    for (const selector of selectors) {
      for (const partialRule of rules.getAllRules()) {
        const rule = this.createRule(partialRule, selector, options);
        this.appendRule(selector, rule);
      }
    }
  }

  getHybridStyleSheet(): HybridStyleSheet {
    const stylesheet: HybridStyleSheet = {};

    if (this.ruleSets.size) {
      stylesheet.s = Object.fromEntries(this.ruleSets.entries());
    }
    const [vr, vu] = this.variableSets;
    if (Object.keys(vr).length > 0) {
      stylesheet.vr = vr as NonNullable<HybridStyleSheet["vr"]>;
    }
    if (Object.keys(vu).length > 0) {
      stylesheet.vu = vu as NonNullable<HybridStyleSheet["vu"]>;
    }
    return stylesheet;
  }

  private appendRule(selector: NormalizedSelector, rule: HybridStyleRule) {
    if (selector.type === "className") {
      const list = this.ruleSets.get(selector.className);
      if (list) {
        list.push(rule);
      } else {
        this.ruleSets.set(selector.className, [rule]);
      }
      return;
    }

    // :root / * variable declarations → vr / vu.
    // Values are [{v, m?}] items so media conditions ride along; the runtime
    // picks the first item whose condition passes (dark subtype forces a
    // prefers-color-scheme condition).
    //
    // A font-size on :root also sets the runtime's rem base.
    const vars = { ...(rule.v ?? {}) };
    if (rule.d) {
      const fontSize = rule.d?.["fontSize"];
      if (fontSize !== undefined) {
        vars["__rn-css-rem"] = fontSize;
      }
    }
    if (Object.keys(vars).length === 0) {
      return;
    }
    const media = this.currentMediaConditions(selector);
    const target = this.variableSets[selector.type === "rootVariables" ? 0 : 1];

    // :root font-size declares the rem base for the whole stylesheet
    if (rule.d) {
      const fontSize = rule.d["fontSize"];
      if (typeof fontSize === "number") {
        this.remBase = fontSize;
        target["__rn-css-rem"] = [{ v: fontSize }];
      }
    }

    for (const [name, value] of Object.entries(vars)) {
      const list = target[name] ?? [];
      list.push(media ? { v: value, m: media } : { v: value });
      target[name] = list;
    }
  }

  /**
   * Media conditions for the current stack, plus the forced color-scheme
   * condition for dark subtype variable selectors
   */
  private currentMediaConditions(
    selector:
      | { type: "className" }
      | { type: "rootVariables" | "universalVariables"; subtype: "light" | "dark" },
  ): AnyMap | undefined {
    const conditions: AnyMap[] = this.mediaStack.flat();
    if (selector.type !== "className" && selector.subtype === "dark") {
      conditions.push({ "prefers-color-scheme": ["=", "dark"] });
    }
    if (conditions.length === 0) {
      return undefined;
    }
    return conditions.length === 1 ? conditions[0] : { and: conditions };
  }

  private createRule(
    partialRule: Partial<HybridStyleRule>,
    selector: NormalizedSelector,
    options?: { important?: boolean },
  ): HybridStyleRule {
    const rule: HybridStyleRule = {
      s:
        selector.type === "className"
          ? [...selector.specificity]
          : createSpecificity(),
      ...partialRule,
    };

    // Source order breaks specificity ties — later rules win (upstream does
    // the same via StylesheetBuilder.shared.ruleOrder)
    rule.s[Specificity.order] = this.ruleOrder;

    if (rule.d) {
      for (const [oldKey, newKey] of Object.entries(this.currentMapping)) {
        if (oldKey in rule.d) {
          const old = rule.d[oldKey];
          if (!old) continue;
          rule.d[newKey] = old;
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete rule.d[oldKey];
        }
      }
    }

    // Container queries from @container at-rules
    if (this.containerStack.length > 0) {
      rule.cq = [...(rule.cq ?? []), ...this.containerStack];
    }

    if (selector.type === "className") {
      if (selector.containerQuery) {
        rule.cq = [...(rule.cq ?? [])];
        rule.cq.push(...selector.containerQuery);
      }
      if (selector.pseudoClassesQuery) {
        rule.pq = { ...rule.pq, ...selector.pseudoClassesQuery };
      }
      if (selector.attributeQuery) {
        // Generated rules target component props (AttributeQuery.a); data-*
        // attribute handling is not differentiated yet
        rule.aq = { a: [...selector.attributeQuery] };
        // Stable id so the runtime can dedupe identical queries across rules
        rule.id = `aq-${attributeQueryId(selector.attributeQuery)}`;
      }
    }

    const media = [
      ...this.mediaStack.flat(),
      ...(selector.type === "className" ? (selector.mediaQuery ?? []) : []),
    ];
    if (media.length === 1) {
      rule.mq = media[0];
    } else if (media.length > 0) {
      rule.mq = { and: media };
    }

    if (options?.important) {
      rule.s[Specificity.important] = 1;
    }

    return rule;
  }

  getWarnings(): string[] {
    // Placeholder for warning generation logic
    return [];
  }
}

/**
 * Deterministic, space-free id for an attribute query so the runtime can
 * dedupe identical queries across rules and class names
 */
function attributeQueryId(query: AttributeQueryRule[]): string {
  const json = JSON.stringify(query);
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = ((hash << 5) + hash + json.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
