// Pins the ["fn", name, ...args] tuple grammar between the compiler and the
// C++ StyleFunction resolvers (cpp/StyleFunction.cpp). If this shape drifts,
// the runtime silently drops declarations.
//
// Note: the typed path (calcArguments) and the token path (mathFunction, used
// when lightningcss can't type a calc containing var()) emit slightly
// different but equally resolvable shapes — subtraction as a negative number
// vs an explicit product(-1, x). The C++ runtime handles both.
import { compile } from "../../compiler";

test("calc with var survives as an fn tuple", () => {
  // lightningcss folds constant expressions, so mix in a var() to force the
  // tuple through to the runtime
  const compiled = compile(`
.test {
  width: calc(var(--width) - 10px);
}`);

  expect(compiled.stylesheet()).toMatchObject({
    s: {
      test: [
        {
          d: {
            width: [
              ["fn", "calc", ["fn", "sum", ["fn", "var", "width"], ["fn", "product", -1, 10]]],
            ],
          },
        },
      ],
    },
  });
});

test("percent keeps percent strings in tuples", () => {
  const compiled = compile(`
.test {
  margin-top: calc(100% - 10px);
}`);

  expect(compiled.stylesheet()).toMatchObject({
    s: {
      test: [
        {
          d: {
            marginTop: ["fn", "calc", ["fn", "sum", "100%", -10]],
          },
        },
      ],
    },
  });
});

test("min/max with vars become runtime tuples", () => {
  const compiled = compile(`
.test {
  width: min(var(--a), var(--b));
}`);

  expect(compiled.stylesheet()).toMatchObject({
    s: {
      test: [
        {
          d: {
            width: [["fn", "min", ["fn", "var", "a"], ["fn", "var", "b"]]],
          },
        },
      ],
    },
  });
});

test("compile-time resolvable math folds to numbers", () => {
  const compiled = compile(`
.test {
  width: min(150px, 300px);
}`);

  expect(compiled.stylesheet()).toMatchObject({
    s: {
      test: [{ d: { width: 150 } }],
    },
  });
});
