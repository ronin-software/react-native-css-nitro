import { compile } from "../compiler";
import { ReferenceRegistry } from "../jest/reference-registry";

test("probe hover declarations", () => {
  const c = compile(`
.text-color { color: blue; }
.text-color:hover { color: red; }
`);
  const s: any = c.stylesheet();
  console.log("rules:", JSON.stringify(s.s));
  const reg = new ReferenceRegistry();
  reg.addStyleSheet(s);
  const d = reg.getDeclarations("id1", "text-color", "root", "root");
  console.log("declarations:", JSON.stringify(d));
});
