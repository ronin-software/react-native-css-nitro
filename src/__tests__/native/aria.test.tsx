import { render, screen } from "@testing-library/react-native";
import { View } from "../../components/View";
import { registerCSS, testID } from "../../jest";

test("aria-selected hyphenated public prop applies styles", () => {
  registerCSS(`.test[aria-selected='true'] { width: 120px; }`);
  render(
    <View
      testID={testID}
      className="test"
      {...({ "aria-selected": "true" } as Record<string, unknown>)}
    />,
  );
  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 120 });
  // flips off without the prop
  render(<View testID={testID} className="test" />);
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});
