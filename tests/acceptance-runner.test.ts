import { describe, expect, it } from "vitest";
import { runChatAcceptance } from "../scripts/acceptance/journey";

describe("mocked video chat acceptance", () => {
  it("checks explanation, follow-up, creative response, and optional provider recovery", async () => {
    const results = await runChatAcceptance();
    expect(results.map(({ id }) => id)).toEqual([
      "explanation", "follow-up", "creative", "stock-fallback", "template-fallback",
    ]);
    for (const result of results) {
      expect(result.report.passed, JSON.stringify(result)).toBe(true);
      expect(result.report.checks.some(({ id }) => id === "human-quality")).toBe(false);
    }
    expect(results[1].plannerInput).toContain(results[0].prompt);
    expect(results[1].plannerInput).toContain("The Moon rotates once per orbit.");
    expect(results[3].warnings).toEqual([]);
    expect(results[4].warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(results)).not.toContain("private-provider-detail");
  });
});
