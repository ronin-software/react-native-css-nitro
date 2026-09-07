import { act, render, screen } from "@testing-library/react-native";
import { View } from "../../components/View";
import { registerCSS, testID } from "../../jest";

test("should update styles", () => {
  registerCSS(`
    .my-class {
      color: red;
    }
  `);

  render(<View testID={testID} className="my-class" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });

  act(() => {
    registerCSS(`
      .my-class {
        color: blue;
      }
    `);
  });

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });
});
