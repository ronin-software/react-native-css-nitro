import { StyleSheet, type ViewProps } from "react-native";
import type { ComponentType } from "react";

import { fireEvent, render } from "@testing-library/react-native";
import { Text } from "../../components/Text";
import { registerCSS, testID } from "../../jest";


// styled() HOC is the "3rd party hook" checklist item — not ported yet.
// Tests using it stay skipped; this stub keeps TS happy.
const styled = (..._args: unknown[]): ComponentType<Record<string, unknown>> => {
  throw new Error("styled() is not ported yet");
};

test("inline styles", () => {
  registerCSS(`.red { background-color: red; }`);

  const component = render(
    <Text
      testID={testID}
      className="red"
      style={{ backgroundColor: "blue" }}
    />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ backgroundColor: "blue" });
});

test("specificity order", () => {
  registerCSS(`.red { color: red; } .blue { color: blue; }`);

  const component = render(
    <Text testID={testID} className="blue red" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#00f" });
});

test("specificity modifiers", () => {
  registerCSS(
    `.redOrGreen:hover { color: green; } .redOrGreen { color: red; } .blue { color: blue; }`,
  );

  const component = render(
    <Text testID={testID} className="blue redOrGreen " />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual(
    { color: "#00f" }, // .blue
  );

  fireEvent(component, "hoverIn");

  expect(component.props.style).toStrictEqual({ color: "#008000" }); // Green
});

test("important - requires sorting", () => {
  registerCSS(`
    .red { color: red; }
    .blue { color: blue !important; }
  `);

  const component = render(
    <Text testID={testID} className="blue red" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#00f" });
});

test("important - inline", () => {
  registerCSS(`
    .blue { background-color: blue !important; }
  `);

  const component = render(
    <Text
      testID={testID}
      className="blue"
      style={{ backgroundColor: "red" }}
    />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ backgroundColor: "#00f" });
});

test("important - modifiers", () => {
  registerCSS(`
    .red { color: red; }
    .red:hover { color: green; }
    .blue { color: blue !important; }
  `);

  const component = render(
    <Text testID={testID} className="blue red" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#00f" });

  fireEvent(component, "hoverIn");

  expect(component.props.style).toStrictEqual({ color: "#00f" });
});

test.skip("passThrough - inline", () => {
  registerCSS(`
    .red { color: red; }
  `);

  const MyText = styled(
    ({ style, ...props }: ViewProps) => {
      return <Text {...props} style={[{ color: "black" }, style]} />;
    },
    { className: "style" },
    { passThrough: true },
  );

  const component = render(
    <MyText testID={testID} className="red" />,
  ).getByTestId(testID);

  // Black wins because it is inline
  expect(StyleSheet.flatten(component.props.style)).toStrictEqual({
    color: "black",
  });
});

test.skip("passThrough - inline reversed", () => {
  registerCSS(`
    .red { color: red; }
  `);

  const MyText = styled(
    ({ style, ...props }: ViewProps) => {
      return <Text {...props} style={[style, { color: "black" }]} />;
    },
    { className: "style" },
    { passThrough: true },
  );

  const component = render(
    <MyText testID={testID} className="red" />,
  ).getByTestId(testID);

  // Black wins because it is inline
  expect(StyleSheet.flatten(component.props.style)).toStrictEqual({
    color: "black",
  });
});

test.skip("passThrough - inline important", () => {
  registerCSS(`
    .red { color: red !important; }
  `);

  const MyText = styled(
    ({ style, ...props }: ViewProps) => {
      return <Text {...props} style={[style, { color: "black" }]} />;
    },
    { className: "style" },
    { passThrough: true },
  );

  const component = render(
    <MyText testID={testID} className="red" />,
  ).getByTestId(testID);

  // Red wins because it is important and overrides the inline style
  expect(StyleSheet.flatten(component.props.style)).toStrictEqual({
    color: "#f00",
  });
});

test.skip("passThrough - inline important existing", () => {
  registerCSS(`
    .red { color: red !important; }
    .blue { color: blue !important; }
  `);

  const MyText = styled(
    ({ style, ...props }: ViewProps) => {
      return (
        <Text {...props} className="blue" style={[style, { color: "black" }]} />
      );
    },
    { className: "style" },
    { passThrough: true },
  );

  const component = render(
    <MyText testID={testID} className="red" />,
  ).getByTestId(testID);

  // Blue wins, because 'red' and 'blue' are both important, but 'blue' has a higher 'order'
  expect(StyleSheet.flatten(component.props.style)).toStrictEqual({
    color: "#00f",
  });
});
