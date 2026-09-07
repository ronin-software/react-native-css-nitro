/**
 * Benchmark: react-native-css JS runtime (upstream v3.x) style-resolution core.
 *
 * Runs the actual shipped JS implementation — their compiler output, their
 * specificity comparator, their calculateProps merge, their var/calc/units
 * resolvers — under Node. Mirrors bench/cpp/bench.cpp workload-for-workload.
 */
import { performance } from "node:perf_hooks";

import type { StyleDescriptor } from "react-native-css/compiler";
import { compile } from "react-native-css/compiler";
import { rootVariables } from "react-native-css/native-internal";
import { VAR_SYMBOL, type Effect } from "react-native-css/native/reactivity";
import { calculateProps } from "react-native-css/native/styles/calculate-props";
import { resolveValue } from "react-native-css/native/styles/resolve";
import { specificityCompareFn } from "react-native-css/utilities";

type AnyRecord = Record<string, any>;

const dummyEffect = { observers: new Set() } as unknown as Effect;
const get = (obs: { get: (e?: Effect) => any }) => obs.get(dummyEffect);

// –
// Variable seeding (their VariableValue format: [[value, mediaQuery?]])
// –

rootVariables("brand").set([["#3490dc", null]]);
rootVariables("spacing").set([[4, null]]);
rootVariables("a").set([["var(--b)", null]]);
rootVariables("b").set([["#00ff00", null]]);
rootVariables("__rn-css-rem").set([[[14], null]]);

// –
// Workload setup: compile CSS with their compiler, take their descriptors
// –

const simpleCss = `
.c0 { color: #ff0000; background-color: #00ff00; padding: 4px; font-size: 14px; }
.c1 { color: #00f; margin: 8px; opacity: 0.5; }
.c2 { border-radius: 4px; border-width: 2px; }
`;

const varCss = `
.x1 { color: var(--brand); }
.x2 { color: var(--a); }
.x3 { width: calc(var(--spacing) * 2); }
.x4 { padding: calc(var(--spacing) * 4); }
`;

function compileRules(css: string): AnyRecord {
  const compiled = compile(css, { inlineVariables: false } as any);
  return (compiled.stylesheet() as any).s;
}

// their stylesheet.s is an array of [className, rules] pairs
function ruleSet(sheet: any, className: string): any[] {
  const entry = sheet.find(([name]: [string]) => name === className);
  return entry ? entry[1] : [];
}

function firstRule(sheet: any, className: string): any {
  return ruleSet(sheet, className)[0];
}

function bench(name: string, iterations: number, fn: () => void): void {
  // warmup
  for (let i = 0; i < Math.min(100, iterations); i++) {
    fn();
  }
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const elapsed = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  console.log(
    `BENCH ${name}: ${iterations} iters in ${elapsed.toFixed(1)}ms → ${opsPerSec.toLocaleString()} ops/s`,
  );
}

// –
// 1. Specificity sort — 200 rules, shuffled
// –

const sortRules: AnyRecord[] = [];
{
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 200; i++) {
    sortRules.push({
      s: [
        rand() > 0.9 ? 1 : 0,
        0,
        0,
        Math.floor(rand() * 3),
        Math.floor(rand() * 400),
      ],
      d: { color: "#000" },
    });
  }
}

bench("sort200", 500, () => {
  const copy = sortRules.slice();
  copy.sort(specificityCompareFn);
});

// –
// 2. Declaration merge + resolve — calculateProps over 15 rules / 60 decls
// –

const mergeSheet = compileRules(
  simpleCss +
    Array.from(
      { length: 13 },
      (_, i) => `.m${i} { color: #123456; opacity: 0.${i}; padding: 2px; }`,
    ).join("\n"),
);
const mergeRules: any[] = mergeSheet.flatMap(
  ([, rules]: [string, any[]]) => rules,
);

bench("merge15rules", 2000, () => {
  calculateProps(get, mergeRules as any);
});

// –
// 3. var() resolution — simple + chained
// –

const varSheet = compileRules(varCss);

// their d is a list of [descriptor, property, flag] triples
function declaration(rule: any, property: string): StyleDescriptor {
  const entry = rule.d.find((d: any[]) => d[1] === property);
  return entry ? entry[0] : undefined;
}

const brandDesc = declaration(firstRule(varSheet, "x1"), "color");
const chainDesc = declaration(firstRule(varSheet, "x2"), "color");
const options = {
  inheritedVariables: { [VAR_SYMBOL]: true },
  inlineVariables: { [VAR_SYMBOL]: "inline" },
} as any;

bench("varSimple", 20000, () => {
  resolveValue(brandDesc as StyleDescriptor, get, options);
});

bench("varChain", 20000, () => {
  resolveValue(chainDesc as StyleDescriptor, get, options);
});

// –
// 4. calc() evaluation
// –

const calcDesc = declaration(firstRule(varSheet, "x3"), "width");
const calcDesc2 = declaration(firstRule(varSheet, "x4"), "padding");

bench("calc", 20000, () => {
  resolveValue(calcDesc as StyleDescriptor, get, options);
  resolveValue(calcDesc2 as StyleDescriptor, get, options);
});

// –
// 5. Composite: sort + merge + resolve for one component
// –

bench("composite", 1000, () => {
  const copy = mergeRules.slice();
  copy.sort(specificityCompareFn);
  calculateProps(get, copy as any);
  resolveValue(brandDesc as StyleDescriptor, get, options);
  resolveValue(calcDesc as StyleDescriptor, get, options);
});

test("bench", () => {
  // sanity: resolutions must produce real values
  expect(resolveValue(brandDesc as any, get, options)).toBe("#3490dc");
  expect(typeof resolveValue(calcDesc as any, get, options)).toBe("number");
});
