import { compile } from "../compiler";
test("probe property", () => {
  const c = compile(`
@property --my-ring { syntax: "*"; inherits: false; initial-value: 0 0 #0000; }
.test { --my-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); box-shadow: var(--my-ring), var(--my-shadow); }
`);
  console.log("R:", JSON.stringify((c.stylesheet() as any).s.test));
});
