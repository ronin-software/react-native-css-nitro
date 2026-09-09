import {
  ImageBackground as RNImageBackground,
  type ImageBackgroundProps,
} from "react-native";

import { useCssElement } from "../../runtime";
import { copyComponentProperties } from "../../utils";

type Props = ImageBackgroundProps & {
  className?: string;
  /** Class applied to the inner image (upstream parity) */
  imageClassName?: string;
  imageStyle?: ImageBackgroundProps["imageStyle"];
};

const mapping = {
  className: "style",
  imageClassName: "imageStyle",
} as const;

export const ImageBackground = copyComponentProperties(
  RNImageBackground,
  (props: Props) => {
    // RNImageBackground renders <Image style={[imageStyle, ...]}> — route the
    // imageClassName styles through the imageStyle target
    return useCssElement(RNImageBackground, props, mapping);
  },
);

export default ImageBackground;
