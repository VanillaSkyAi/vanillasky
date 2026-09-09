import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { selectBrowserShard } from "../scripts/browser-shard.mjs";

describe("balanced browser groups", () => {
  it("covers each real browser test exactly once and spreads related slow cases", () => {
    const listing = execFileSync(process.execPath, ["node_modules/playwright/cli.js", "test", "--project=webkit", "--list", "--reporter=list"], { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });
    const all = selectBrowserShard(listing, 1, 1);
    const groups = [1, 2, 3].map(current => selectBrowserShard(listing, current, 3));
    expect(groups.flat().sort()).toEqual([...all].sort());
    expect(new Set(groups.flat()).size).toBe(all.length);
    expect(Math.max(...groups.map(group => group.length)) - Math.min(...groups.map(group => group.length))).toBeLessThanOrEqual(1);
    const narrationCounts = groups.map(group => group.filter(test => test.includes("continuous-video.spec.ts")).length);
    expect(Math.min(...narrationCounts)).toBeGreaterThan(0);
    expect(Math.max(...narrationCounts) - Math.min(...narrationCounts)).toBeLessThanOrEqual(1);
  });
  it("fails on invalid, empty or ambiguous partitions", () => {
    const test = "  [webkit] › example.spec.ts:1:1 › title";
    for (const [current, total] of [[0, 3], [4, 3], [1, 0], [1.5, 3], [2, 3]]) {
      expect(() => selectBrowserShard(test, current, total)).toThrow();
    }
    expect(() => selectBrowserShard("no tests", 1, 3)).toThrow();
    expect(() => selectBrowserShard(`${test}\n${test}`, 1, 3)).toThrow();
  });
});
