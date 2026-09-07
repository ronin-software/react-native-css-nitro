import { FlatList as RNFlatList } from "react-native";

import { useCssElement } from "../../runtime";
import { copyComponentProperties } from "../../utils";

const mapping = {
  className: "style",
  ListFooterComponentClassName: "ListFooterComponentStyle",
  ListHeaderComponentClassName: "ListHeaderComponentStyle",
  columnWrapperClassName: "columnWrapperStyle",
  contentContainerClassName: "contentContainerStyle",
};

export const FlatList = copyComponentProperties(
  RNFlatList,
  function FlatList(props: Record<string, any>) {
    return useCssElement(RNFlatList, props, mapping);
  },
);
export default FlatList;
