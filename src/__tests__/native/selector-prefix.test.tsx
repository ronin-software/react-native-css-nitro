import { render, screen } from "@testing-library/react-native";
import { View } from "../../components/View";
import { registerCSS, testID } from "../../jest";

test("type prefix", () => {
  registerCSS(`html .my-class { color: red; }`, {
    selectorPrefix: "html",
  });

  render(<View testID={testID} className="my-class" />);

  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    color: "#f00",
  });
});

test("class prefix", () => {
  registerCSS(`.test .my-class { color: red; }`, {
    selectorPrefix: ".test",
  });

  render(<View testID={testID} className="my-class" />);

  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    color: "#f00",
  });
});
