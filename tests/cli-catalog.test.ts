import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runVanillaSkyCli } from "../src/cli/index";
import { syncTemplates } from "../src/cli/sync";

function source(id: string, useWhen: string): string {
  return `
export const template = {
  id: ${JSON.stringify(id)},
  label: ${JSON.stringify(`${id} project`)},
  description: "Project description",
  family: "Explainers",
  jobs: ["setup"],
  register: "card-led",
  useWhen: ${JSON.stringify(useWhen)},
  avoidWhen: "Avoid unsupported claims.",
  usesGlobalTextEffect: false,
  usesGlobalTransition: false,
  usesGlobalBackgroundEffect: false,
  minDuration: 2,
  preferredDuration: 5,
  schema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 4, maxLength: 40, description: "Grounded title" },
      tone: { type: "string", enum: ["calm", "urgent"] },
      bullets: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", minLength: 2, maxLength: 24 } },
    },
    required: ["title"],
  },
  component: () => null,
};
`;
}

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), "vanillasky-effective-catalog-"));
  mkdirSync(join(cwd, "vanillasky/templates"), { recursive: true });
  writeFileSync(join(cwd, "vanillasky/templates/keyFigure.tsx"), source("keyFigure", "Use the project metric treatment."));
  writeFileSync(join(cwd, "vanillasky/templates/customerHealth.tsx"), source("customerHealth", "Explain customer health."));
  return cwd;
}

async function run(argv: string[], cwd: string): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  const code = await Promise.resolve(runVanillaSkyCli(argv, { cwd, write: (line) => lines.push(line) }));
  return { code, output: lines.join("\n") };
}

describe("effective template catalog CLI", () => {
  it("lists built-ins plus project additions with project overrides and stable columns", async () => {
    const cwd = project();
    await syncTemplates({ cwd });

    const result = await run(["templates", "list"], cwd);

    expect(result.code).toBe(0);
    const rows = result.output.split("\n");
    expect(rows[0]).toBe("ID\tORIGIN\tSTATUS\tUSE WHEN");
    expect(rows.filter((row) => row.startsWith("keyFigure\t"))).toEqual([
      "keyFigure\tproject\tcurrent\tUse the project metric treatment.",
    ]);
    expect(rows).toContain("customerHealth\tproject\tcurrent\tExplain customer health.");
    expect(rows.some((row) => row.startsWith("editorialTimeline\tbuilt-in\tavailable\t"))).toBe(true);
  });

  it("supports machine-readable effective and packaged-only catalogs", async () => {
    const cwd = project();

    const effective = await run(["templates", "list", "--json"], cwd);
    expect(effective.code).toBe(0);
    const effectiveItems = JSON.parse(effective.output) as Array<Record<string, unknown>>;
    expect(effectiveItems.find(({ id }) => id === "keyFigure")).toMatchObject({
      id: "keyFigure", origin: "project", status: "stale", useWhen: "Use the project metric treatment.",
      summary: "Project description",
    });
    expect(effectiveItems.find(({ id }) => id === "customerHealth")).toMatchObject({ origin: "project" });

    const builtin = await run(["templates", "list", "--builtin", "--json"], cwd);
    expect(builtin.code).toBe(0);
    const builtinItems = JSON.parse(builtin.output) as Array<Record<string, unknown>>;
    expect(builtinItems.find(({ id }) => id === "keyFigure")).toMatchObject({
      id: "keyFigure", origin: "built-in", status: "available",
    });
    expect(builtinItems.some(({ id }) => id === "customerHealth")).toBe(false);
  });

  it("describes the effective override with planner, schema, duration, and generated-file status", async () => {
    const cwd = project();
    await syncTemplates({ cwd });

    const json = await run(["templates", "describe", "keyFigure", "--json"], cwd);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.output)).toMatchObject({
      id: "keyFigure",
      title: "keyFigure project",
      origin: "project",
      status: "current",
      planner: {
        useWhen: "Use the project metric treatment.",
        avoidWhen: "Avoid unsupported claims.",
      },
      family: "Explainers",
      jobs: ["setup"],
      register: "card-led",
      duration: { min: 2, preferred: 5 },
      generated: {
        browser: { path: "vanillasky/index.ts", current: true },
        server: { path: "vanillasky/server.ts", current: true },
        current: true,
      },
      wiring: { applicationImportsInspected: false, verified: false },
      schemaSummary: {
        title: { type: "string", required: true, description: "Grounded title" },
      },
    });

    writeFileSync(join(cwd, "vanillasky/server.ts"), `${readFileSync(join(cwd, "vanillasky/server.ts"), "utf8")}\n// drift`);
    const stale = await run(["templates", "describe", "keyFigure", "--json"], cwd);
    expect(JSON.parse(stale.output)).toMatchObject({
      status: "stale",
      generated: {
        browser: { current: true },
        server: { current: false },
        current: false,
      },
    });

    const text = await run(["templates", "describe", "keyFigure"], cwd);
    expect(text.output).toContain("Origin\tproject");
    expect(text.output).toContain("Generated files\tstale");
    expect(text.output).toContain("Use when\tUse the project metric treatment.");
    expect(text.output).toContain("Duration\t2s minimum, 5s preferred");
    expect(text.output).toContain("title\tstring{4..40}\trequired");
    expect(text.output).toContain("tone\tenum(calm|urgent)\toptional");
    expect(text.output).toContain("bullets\tstring-array[1..3]{2..24}\toptional");
    expect(text.output).toContain("Application wiring\tnot inspected or verified");
  });

  it("describes a packaged template without executing or claiming generated wiring", async () => {
    const cwd = project();
    writeFileSync(join(cwd, "vanillasky/templates/hang.tsx"), "while (true) {}\n");

    const listed = await run(["templates", "list", "--builtin", "--json"], cwd);
    expect(listed.code).toBe(0);
    expect((JSON.parse(listed.output) as Array<{ id: string }>).some(({ id }) => id === "keyFigure")).toBe(true);

    const result = await run(["templates", "describe", "keyFigure", "--builtin", "--json"], cwd);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      id: "keyFigure",
      origin: "built-in",
      status: "available",
      generated: {
        browser: { path: "vanillasky/index.ts", current: null },
        server: { path: "vanillasky/server.ts", current: null },
        current: null,
      },
    });
    expect(existsSync(join(cwd, "vanillasky/index.ts"))).toBe(false);
  });

  it("rejects unexpected list arguments and preserves describe JSON selection guidance", async () => {
    const cwd = project();
    const garbage = await run(["templates", "list", "garbage"], cwd);
    expect(garbage).toEqual({ code: 1, output: "Unexpected list argument: garbage" });

    const described = await run(["templates", "describe", "keyFigure", "--json"], cwd);
    expect(JSON.parse(described.output)).toMatchObject({
      useWhen: "Use the project metric treatment.",
      summary: "Project description",
    });
  });
});
