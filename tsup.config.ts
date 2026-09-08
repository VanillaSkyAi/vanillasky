import { defineConfig } from "tsup";
import { copyFile, mkdir } from "node:fs/promises";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    react: "src/react.ts",
    test: "src/test.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  // Keep the published package within budget now that built-in renderers are
  // code-split. The emitted ESM remains readable and canonical sources live in
  // the repository.
  sourcemap: false,
  clean: true,
  splitting: true,
  external: ["react", "react-dom"],
  async onSuccess() {
    await mkdir("dist/assets", { recursive: true });
    await copyFile("src/video-chat/assets/vanillasky-logo.svg", "dist/assets/vanillasky-logo.svg");
  },
});
