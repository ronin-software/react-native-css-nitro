import { render } from "@testing-library/react-native";
import { Image } from "react-native";
import { TextInput } from "../../components/TextInput";
import { ImageBackground } from "../../components/ImageBackground";
import { registerCSS, testID } from "../../jest";

test("TextInput text-align extracts to the textAlign prop", () => {
  registerCSS(`.text-center { text-align: center; }`);
  const c = render(<TextInput testID={testID} className="text-center" />).getByTestId(testID);
  expect(c.props.textAlign).toBe("center");
  expect(c.props.style).not.toHaveProperty("textAlign");
});

test("TextInput text-align coexists with other class styles", () => {
  registerCSS(`
    .text-center { text-align: center; }
    .text-red { color: red; }
  `);
  const c = render(
    <TextInput testID={testID} className="text-center text-red" />,
  ).getByTestId(testID);
  expect(c.props.textAlign).toBe("center");
  expect(c.props.style).toStrictEqual({ color: "#f00" });
});

test("ImageBackground imageClassName styles the inner image", () => {
  registerCSS(`
    .w10h10 { width: 40px; height: 40px; }
    .img-opacity { opacity: 0.5; }
  `);
  const { UNSAFE_getByType } = render(
    <ImageBackground
      className="w10h10"
      imageClassName="img-opacity"
      source={{ uri: "https://example.com/i.png" }}
    />,
  );
  const inner = UNSAFE_getByType(Image);
  const flat = JSON.stringify(inner.props.style);
  // imageClassName styles reach the inner image…
  expect(flat).toContain('"opacity":0.5');
  // …alongside RN's width/height proxy of the host className styles
  expect(flat).toContain('"width":40');
});
