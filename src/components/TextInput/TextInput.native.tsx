import { TextInput as RNTextInput, type TextInputProps } from "react-native";

import { useCssElement } from "../../runtime";
import { copyComponentProperties } from "../../utils";

// Built-in text alignment: the class style's textAlign extracts into the
// prop (RNTextInput has no textAlign style — it is a direct prop). Done with
// an explicit destination so the mapping never receives a boolean.
const mapping = {
  className: {
    target: "style",
    nativeStyleMapping: { textAlign: "textAlign" },
  },
} as const;

export const TextInput = copyComponentProperties(
  RNTextInput,
  (props: TextInputProps & { className?: string }) => {
    return useCssElement(RNTextInput, props, mapping);
  },
);

export default TextInput;
