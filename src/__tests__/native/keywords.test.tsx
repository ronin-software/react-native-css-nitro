import { View } from "react-native";

import { renderHook } from "@testing-library/react-native";

import { registerCSS } from "../../jest";
import { useNativeCss } from "../../native";

test("unset", () => {
  registerCSS(`.my-class { background-color: unset; }`);

  const { result } = renderHook(() => {
    return useNativeCss(View, { className: "my-class" });
  });

  expect(result.current.props).toMatchObject({
    style: { backgroundColor: undefined },
  });
});
