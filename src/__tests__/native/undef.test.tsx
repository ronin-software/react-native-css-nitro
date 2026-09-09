import { render, screen } from "@testing-library/react-native";
import { View } from "../../components/View";
import { registerCSS, testID } from "../../jest";

test("explicit undefined prop does not erase the class style", () => {
  registerCSS(`.w80 { width: 80px; }`);
  // passing width explicitly as undefined (the v5 failure mode)
  render(
    <View
      testID={testID}
      className="w80"
      {...({ style: undefined } as Record<string, unknown>)}
    />,
  );
  const c = screen.getByTestId(testID);
  console.log("STYLE:", JSON.stringify(c.props.style));
  expect(c.props.style).toStrictEqual({ width: 80 });
});
