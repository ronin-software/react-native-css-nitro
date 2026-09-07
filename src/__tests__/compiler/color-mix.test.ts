import { compile } from "../../compiler";

test("color-mix() - black with transparent (NaN oklab channels)", () => {
  // lightningcss resolves this at compile time to oklab(0 NaN NaN / 0.5):
  // black is oklab [l=0, a=0, b=0] and transparent has no chromaticity, so the
  // a/b channels degenerate to NaN. Without coercing NaN to 0 the color
  // serializes to "#NaNNaNNaN80", which React Native silently discards.
  // This is what Tailwind's `bg-black/50` compiles to.
  const compiled = compile(`
.test {
  background-color: color-mix(in oklab, #000 50%, transparent);
}`);

  expect(compiled.stylesheet()).toMatchObject({
    s: {
      test: [
        {
          d: {
            backgroundColor: "#00000080",
          },
        },
      ],
    },
  });
});
