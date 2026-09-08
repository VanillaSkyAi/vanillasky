import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// Exercise the bundler boundary used by the application, not a published export list.
describe("application module boundaries", () => {
  it("bundles the browser entry without server code, provider clients or Node builtins", async () => {
    const result = await build({
      entryPoints: ["src/react.ts"], bundle: true, write: false, platform: "browser", format: "esm",
      external: ["react", "react-dom", "react/jsx-runtime"], loader: { ".svg": "dataurl" }, metafile: true,
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some(path => path.startsWith("src/server/") || path.startsWith("functions/"))).toBe(false);
    expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)
      .every(item => ["react", "react-dom", "react/jsx-runtime"].includes(item.path))).toBe(true);
  });
  it("bundles the server entry without React or browser player modules", async () => {
    const result = await build({ entryPoints: ["src/server.ts"], bundle: true, write: false,
      platform: "neutral", format: "esm", metafile: true });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some(path => path.includes("node_modules/react") || path.startsWith("src/player/"))).toBe(false);
    expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  });
});
