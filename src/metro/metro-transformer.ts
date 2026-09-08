import { unstable_transformerPath } from "@expo/metro-config";
import type {
  JsTransformerConfig,
  JsTransformOptions,
  TransformResponse,
} from "metro-transform-worker";

import { compile, type CompilerOptions } from "../compiler";
import { getNativeInjectionCode } from "./injection-code";

const worker =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(unstable_transformerPath) as typeof import("metro-transform-worker");

export async function transform(
  config: JsTransformerConfig & {
    reactNativeCSS?: CompilerOptions | undefined;
  },
  projectRoot: string,
  filePath: string,
  data: Buffer,
  options: JsTransformOptions,
): Promise<TransformResponse> {
  const isCss = options.type !== "asset" && /\.(s?css|sass)$/.test(filePath);

  if (options.platform === "web" || !isCss) {
    return worker.transform(config, projectRoot, filePath, data, options);
  }

  const cssFile = (await worker.transform(config, projectRoot, filePath, data, {
    ...options,
    platform: "web",
  })) as TransformResponse & {
    output: [{ data: { css: { code: Buffer } } }];
  };

  const css = cssFile.output[0].data.css.code.toString();
  if (process.env.RN_CSS_TRACE) {
    console.error(
      "[rn-css-transformer]",
      filePath,
      "css bytes:",
      css.length,
      "head:",
      JSON.stringify(css.slice(0, 120)),
    );
  }

  const productionJS = compile(css, {
    ...config.reactNativeCSS,
    filename: filePath,
    projectRoot: projectRoot,
  }).stylesheet();

  data = Buffer.from(getNativeInjectionCode([], [productionJS]));

  const transform = await worker.transform(
    config,
    projectRoot,
    `${filePath}.js`,
    data,
    options,
  );

  (transform as any).output[0].data.css = {
    skipCache: true,
    code: "",
  };

  return transform;
}
