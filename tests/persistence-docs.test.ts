import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("persistence documentation contract", () => {
  it("documents the strict current-only storage boundary and host ownership", () => {
    const api = readFileSync("PUBLIC-API.md", "utf8");
    const guide = readFileSync("docs/persistence.md", "utf8");
    const readme = readFileSync("README.md", "utf8");

    expect(api).toContain("`parseVideo(value: unknown): Video`");
    expect(api).toContain("`VideoValidationError`");
    expect(api).toContain("`VideoValidationErrorCode`");
    expect(api).toContain('`schemaVersion: "0.2"`');
    expect(guide).toContain("JSON.parse");
    expect(guide).toContain("parseVideo");
    expect(guide).toContain('from "@vanillaskyai/video"');
    expect(guide).toContain('from "@vanillaskyai/video/react"');
    expect(guide).not.toContain(["@vanillaskyai", "sdk"].join("/"));
    expect(guide).toContain("unsupported_video_version");
    expect(guide).toContain("turn.completed");
    expect(guide).not.toContain("snapshotRetention");
    expect(guide).toMatch(/host owns.*database.*storage/is);
    expect(guide).toMatch(/URL expiry/is);
    expect(guide).toMatch(/not.*authenticity/is);
    expect(guide).toMatch(/media.*network requests/is);
    expect(readme).toContain("[Persistence and replay](docs/persistence.md)");
  });

  it("marks the persistence example for exact packed-package compilation", () => {
    const guide = readFileSync("docs/persistence.md", "utf8");
    const verifier = readFileSync("scripts/verify-packed-package.mjs", "utf8");

    expect(guide).toContain("<!-- verify:persistence-example:start -->");
    expect(guide).toContain("<!-- verify:persistence-example:end -->");
    expect(verifier).toContain('join(packageRoot, "docs", "persistence.md")');
    expect(verifier).toContain('join(consumer, "persistence-example.tsx")');
    expect(verifier).toContain('include: ["persistence-example.tsx"]');
  });
});
