import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("self-hosted typography fallback", () => {
  it("ships licensed pinned WOFF2 subsets whose recorded hashes match", () => {
    const manifest = JSON.parse(readFileSync("styles/fonts/manifest.json", "utf8"));
    expect(manifest.weights).toEqual([400, 500]);
    expect(readFileSync(`styles/fonts/${manifest.license}`, "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    for (const entry of manifest.files) {
      const bytes = readFileSync(`styles/fonts/${entry.file}`);
      expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }
  });
  it("registers local fallback faces without preloading or external requests", () => {
    const css = readFileSync("styles/fonts/roboto.css", "utf8");
    expect(css).not.toMatch(/https?:|@import/);
    expect(css).toContain("font-weight: 400 500");
    expect(css).toContain("unicode-range:");
    expect(readFileSync("styles/video-chat.css", "utf8")).toContain('@import "./fonts/roboto.css";');
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.files).toContain("styles/fonts");
    expect(pkg.sideEffects).toContain("./styles/fonts/roboto.css");
  });
});
