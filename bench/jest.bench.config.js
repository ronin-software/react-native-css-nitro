const path = require("path");
const os = require("os");
const home = os.homedir();
const ourRN = path.resolve(__dirname, "../node_modules/react-native");
const refSrc = path.join(home, "nativewind-e2e/react-native-css/src");

module.exports = {
  rootDir: path.resolve(__dirname, ".."),
  preset: "react-native",
  testMatch: ["<rootDir>/bench/*.bench.test.ts"],
  modulePathIgnorePatterns: ["<rootDir>/example/node_modules", "<rootDir>/lib/"],
  moduleNameMapper: {
    "^react-native$": ourRN,
    "^react-native/(.*)$": ourRN + "/$1",
    "^react-native-css/native-internal$": refSrc + "/native-internal/index.ts",
    "^react-native-css/native/(.*)$": refSrc + "/native/$1",
    "^react-native-css/(.*)$": refSrc + "/$1",
  },
};
