import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "./src-web/index.ts",
  noExternal: () => true,
  inlineOnly: false,
});
