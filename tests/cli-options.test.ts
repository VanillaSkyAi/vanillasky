import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runVanillaSkyCli } from "../src/cli/index";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function project() {
  const cwd = mkdtempSync(join(tmpdir(), "vanillasky-cli-options-"));
  directories.push(cwd);
  const output: string[] = [];
  const environment = { cwd, write: (line: string) => output.push(line), sdkSpec: "@vanillaskyai/video@0.11.0",
    installDependencies: async () => undefined };
  return { cwd, output, run: (args: string[]) => runVanillaSkyCli(args, environment) };
}

it("initializes the native text option without adding an AI framework", async () => {
  const app = project();
  expect(await app.run(["init", "--native"]), app.output.join("\n")).toBe(0);
  const manifest = JSON.parse(readFileSync(join(app.cwd, "package.json"), "utf8"));
  expect(manifest.dependencies).not.toHaveProperty("ai");
  expect(manifest.dependencies).not.toHaveProperty("@ai-sdk/anthropic");
  expect(await app.run(["init"]), app.output.join("\n")).toBe(0);
  const repeated = JSON.parse(readFileSync(join(app.cwd, "package.json"), "utf8"));
  expect(repeated.dependencies).not.toHaveProperty("ai");
});

it.each(["fal", "google", "runway", "custom"])("selects the %s video adapter independently of transcription", async vendor => {
  const app = project();
  expect(await app.run(["init"]), app.output.join("\n")).toBe(0);
  expect(await app.run(["providers", "add", "video", vendor]), app.output.join("\n")).toBe(0);
  const before = JSON.parse(readFileSync(join(app.cwd, "package.json"), "utf8"));
  expect(before.vanillasky.providers).toContain("video");
  expect(before.vanillasky.videoVendor).toBe(vendor);
  expect(before.vanillasky.providers).not.toContain("transcription");
  expect(await app.run(["providers", "add", "transcription"]), app.output.join("\n")).toBe(0);
  const after = JSON.parse(readFileSync(join(app.cwd, "package.json"), "utf8"));
  expect(after.vanillasky.providers).toContain("transcription");
});

it.each([
  ["templates", "list"], ["init", "--unknown"], ["providers", "add", "video", "unknown"],
  ["providers", "add", "speech", "google"], ["providers", "add", "transcription", "fal"],
])("rejects unsupported arguments without creating project files: %j", async (...args: string[]) => {
  const app = project();
  expect(await app.run(args)).toBe(1);
  expect(readdirSync(app.cwd)).toEqual([]);
});
