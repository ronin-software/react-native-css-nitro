import { act, render, screen } from "@testing-library/react-native";
import { View } from "../../components/View";
import { registerCSS, testID } from "../../jest";
import { colorScheme } from "../../runtime";

test.skip(":is(.dark *)", () => {
  registerCSS(`@cssInterop set darkMode class dark;
.my-class:is(.dark *) { color: red; }`);

  render(<View testID={testID} className="my-class" />);

  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual(undefined);

  act(() => {
    colorScheme.set("dark");
  });

  expect(component.props.style).toStrictEqual({ color: "#f00" });
});

test.skip(':root[class="dark"]', () => {
  registerCSS(`@cssInterop set darkMode class dark;
:root[class="dark"] {
  --my-var: red;
}
.my-class { 
  color: var(--my-var); 
}`);

  render(<View testID={testID} className="my-class" />);

  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual({});

  act(() => {
    colorScheme.set("dark");
  });

  expect(component.props.style).toStrictEqual({ color: "red" });
});

test.skip(':root[class~="dark"]', () => {
  registerCSS(`
    @react-native {
      darkMode: dark;
    }

    :root[class~="dark"] {
      --my-var: red;
    }
    .my-class { 
      color: var(--my-var); 
    }
  `);

  render(<View testID={testID} className="my-class" />);

  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual({});

  act(() => {
    colorScheme.set("dark");
  });

  expect(component.props.style).toStrictEqual({ color: "red" });
});
