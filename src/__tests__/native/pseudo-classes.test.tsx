import { act, fireEvent, render, screen } from "@testing-library/react-native";

// Note: uses Text because Pressable consumes onHoverIn for its own hover
// state and does not forward it to the host view
import { Text } from "../../components/Text";
import { registerCSS, testID } from "../../jest";

test("hover", () => {
  registerCSS(`
    .text-color {
      color: blue;
    }

    .text-color:hover {
      color: red;
    }
  `);

  render(<Text testID={testID} className="text-color" />);
  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#00f" });
  expect(typeof component.props.onHoverIn).toBe("function");
  expect(typeof component.props.onHoverOut).toBe("function");

  act(() => {
    fireEvent(component, "hoverIn");
  });

  expect(component.props.style).toStrictEqual({ color: "#f00" });

  act(() => {
    fireEvent(component, "hoverOut");
  });

  expect(component.props.style).toStrictEqual({ color: "#00f" });
});
