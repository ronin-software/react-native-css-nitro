import { render, screen } from "@testing-library/react-native";
import { View } from "../../components/View";
import { registerCSS, testID } from "../../jest";

test("scale percentage resolves to a numeric transform factor", () => {
  registerCSS(`.test { scale: 50%; }`);
  render(<View testID={testID} className="test" />);
  expect(screen.getByTestId(testID).props.style.transform).toStrictEqual([
    { scaleX: 0.5 },
    { scaleY: 0.5 },
  ]);
});

test("scale-x/scale-y percentages resolve to numeric factors", () => {
  registerCSS(`.test { scale: 25% 75%; }`);
  render(<View testID={testID} className="test" />);
  expect(screen.getByTestId(testID).props.style.transform).toStrictEqual([
    { scaleX: 0.25 },
    { scaleY: 0.75 },
  ]);
});
