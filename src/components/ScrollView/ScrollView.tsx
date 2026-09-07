import { ScrollView as RNScrollView } from "react-native";

import { useCssElement } from "../../runtime";
import { copyComponentProperties } from "../../utils";

const mapping = {
  className: "style",
  contentContainerClassName: "contentContainerStyle",
};

export const ScrollView = copyComponentProperties(
  RNScrollView,
  (props: Record<string, any>) => useCssElement(RNScrollView, props, mapping),
);
export default ScrollView;
