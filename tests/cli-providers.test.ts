import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVanillaSkyCli } from "../src/cli/index";
import { addVideoChatProvider } from "../src/cli/providers";

const directories: string[] = [];
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "video-provider-"));
  directories.push(cwd);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ private: true, dependencies: { "@vanillaskyai/video": "0.7.1" } }));
  writeFileSync(join(cwd, "providers.ts"), 'import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";\n\nexport const providers: Pick<VideoChatHandlerOptions, "generateSpeech" | "generateVideo" | "transcribe"> = {};\n');
  return cwd;
}
afterEach(() => directories.splice(0).forEach((cwd) => rmSync(cwd, { recursive: true, force: true })));

describe("optional provider setup", () => {
  it.each(["fal", "google", "runway", "custom"] as const)("copies an app-owned %s video adapter without vendor packages or transcription", async (vendor) => {
    const cwd = fixture();
    await addVideoChatProvider("video", { cwd, vendor, installDependencies: async () => undefined });
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    expect(manifest.dependencies).toEqual({ "@vanillaskyai/video": "0.7.1" });
    expect(manifest.vanillasky.videoVendor).toBe(vendor);
    expect(existsSync(join(cwd, "providers/video-job.ts"))).toBe(true);
    expect(existsSync(join(cwd, "providers/video-delivery.ts"))).toBe(true);
    expect(readFileSync(join(cwd, "providers/video.ts"), "utf8")).not.toContain("transcribe:");
    await addVideoChatProvider("transcription", { cwd, installDependencies: async () => undefined });
    expect(readFileSync(join(cwd, "providers/transcription.ts"), "utf8")).toContain("transcribe:");
  });

  it("does not overwrite an installed vendor when asked to switch", async () => {
    const cwd = fixture();
    await addVideoChatProvider("video", { cwd, vendor: "google", installDependencies: async () => undefined });
    const before = readFileSync(join(cwd, "providers/video.ts"), "utf8");
    await expect(addVideoChatProvider("video", { cwd, vendor: "runway", installDependencies: async () => undefined })).rejects.toThrow(/already|manually/);
    expect(readFileSync(join(cwd, "providers/video.ts"), "utf8")).toBe(before);
  });
  it("installs only selected providers and preserves edited adapters on repeat", async () => {
    const cwd = fixture();
    const installDependencies = vi.fn(async () => undefined);
    const environment = { cwd, installDependencies, write: vi.fn() };
    expect(await runVanillaSkyCli(["providers", "add", "speech"], environment)).toBe(0);
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    expect(manifest.dependencies["@ai-sdk/xai"]).toBe("^4.0.52");
    expect(manifest.dependencies["@fal-ai/client"]).toBeUndefined();
    expect(manifest.vanillasky.providers).toEqual(["speech"]);
    const adapter = join(cwd, "providers/speech.ts");
    writeFileSync(adapter, readFileSync(adapter, "utf8") + "\n// customer customization\n");
    expect(await runVanillaSkyCli(["providers", "add", "speech"], environment)).toBe(0);
    expect(readFileSync(adapter, "utf8")).toContain("customer customization");
    expect(await runVanillaSkyCli(["providers", "add", "video"], environment)).toBe(0);
    expect(readFileSync(join(cwd, "providers.ts"), "utf8")).toContain("...speechProvider");
    expect(readFileSync(join(cwd, "providers.ts"), "utf8")).toContain("...videoProvider");
    expect(installDependencies).toHaveBeenCalledTimes(3);
  });

  it("retries installation after an interrupted provider setup", async () => {
    const cwd = fixture();
    const installDependencies = vi.fn().mockRejectedValueOnce(new Error("install interrupted")).mockResolvedValue(undefined);
    const environment = { cwd, installDependencies, write: vi.fn() };
    expect(await runVanillaSkyCli(["providers", "add", "video"], environment)).toBe(1);
    expect(await runVanillaSkyCli(["providers", "add", "video"], environment)).toBe(0);
    expect(installDependencies).toHaveBeenCalledTimes(2);
  });

  it("rejects conflicting source before changing the manifest or installing", async () => {
    const cwd = fixture();
    mkdirSync(join(cwd, "providers"));
    writeFileSync(join(cwd, "providers/speech.ts"), "// unrelated source\n");
    const before = readFileSync(join(cwd, "package.json"), "utf8");
    const installDependencies = vi.fn();
    expect(await runVanillaSkyCli(["providers", "add", "speech"], { cwd, installDependencies, write: vi.fn() })).toBe(1);
    expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe(before);
    expect(installDependencies).not.toHaveBeenCalled();
  });

  it("rejects unknown providers and modified registry wiring", async () => {
    const cwd = fixture();
    const environment = { cwd, installDependencies: vi.fn(), write: vi.fn() };
    expect(await runVanillaSkyCli(["providers", "add", "unknown"], environment)).toBe(1);
    writeFileSync(join(cwd, "providers.ts"), "// customer-owned wiring\n");
    expect(await runVanillaSkyCli(["providers", "add", "speech"], environment)).toBe(1);
    expect(environment.installDependencies).not.toHaveBeenCalled();
  });

  it("preserves pre-existing temporary files while registering a provider", async () => {
    const cwd = fixture();
    const temporary = join(cwd, "package.json.vanillasky-tmp");
    writeFileSync(temporary, "customer-owned file");
    expect(await runVanillaSkyCli(["providers", "add", "speech"], {
      cwd, installDependencies: vi.fn(), write: vi.fn(),
    })).toBe(0);
    expect(existsSync(temporary)).toBe(true);
    expect(readFileSync(temporary, "utf8")).toBe("customer-owned file");
  });

  it.each(["providers", "providers.ts", "package.json"])("rejects symlink traversal through %s before writes", async (target) => {
    const cwd = fixture();
    const outside = fixture();
    const path = join(cwd, target);
    if (existsSync(path)) rmSync(path);
    symlinkSync(target === "providers" ? outside : join(outside, target), path);
    const before = readFileSync(join(outside, "package.json"), "utf8");
    const installDependencies = vi.fn();
    const output: string[] = [];
    expect(await runVanillaSkyCli(["providers", "add", "speech"], {
      cwd, installDependencies, write: (line) => output.push(line),
    })).toBe(1);
    expect(output.join("\n")).toMatch(/symbolic link/i);
    expect(installDependencies).not.toHaveBeenCalled();
    expect(readFileSync(join(outside, "package.json"), "utf8")).toBe(before);
    expect(existsSync(join(outside, "speech.ts"))).toBe(false);
  });

  it("rejects malformed provider registration without replacing configuration", async () => {
    const cwd = fixture();
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    manifest.vanillasky = { providers: ["speech", "speech"] };
    writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest));
    const before = readFileSync(join(cwd, "package.json"), "utf8");
    const installDependencies = vi.fn();
    expect(await runVanillaSkyCli(["providers", "add", "video"], {
      cwd, installDependencies, write: vi.fn(),
    })).toBe(1);
    expect(installDependencies).not.toHaveBeenCalled();
    expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe(before);
  });

});
