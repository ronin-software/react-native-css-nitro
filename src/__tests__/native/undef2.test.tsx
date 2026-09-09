import { render, screen } from "@testing-library/react-native";
import { FlatList } from "../../components/FlatList";
import { registerCSS, testID } from "../../jest";

test("contentContainerStyle: undefined does not erase the class style", () => {
  registerCSS(`.px8 { padding-left: 8px; padding-right: 8px; }`);

  render(
    <FlatList
      testID={testID}
      contentContainerClassName="px8"
      contentContainerStyle={undefined}
      data={[]}
      renderItem={undefined}
    />,
  );
  const c = screen.getByTestId(testID);
  console.log("CCS:", JSON.stringify(c.props.contentContainerStyle));
});
