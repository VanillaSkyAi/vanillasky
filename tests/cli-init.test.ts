import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVanillaSkyCli } from "../src/cli/index";

const fixtures: string[] = [];
const starterRoot = join(process.cwd(), "starters", "video-chat");

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), "vanillasky-init-"));
  fixtures.push(cwd);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({
    name: "my-video-chat",
    private: true,
    dependencies: { "@vanillaskyai/video": "^0.6.0" },
  }, null, 2));
  return cwd;
}

function blankProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "vanillasky-init-blank-"));
  fixtures.push(cwd);
  return cwd;
}

function markInstalled(cwd: string): void {
  const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const directory = join(cwd, "node_modules", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  }
}

async function run(
  cwd: string,
  argv: string[],
  installDependencies = vi.fn(async () => { markInstalled(cwd); }),
): Promise<{ code: number; output: string; installDependencies: typeof installDependencies }> {
  const output: string[] = [];
  const code = await Promise.resolve(runVanillaSkyCli(argv, {
    cwd,
    write: (line) => output.push(line),
    starterRoot,
    installDependencies,
  } as Parameters<typeof runVanillaSkyCli>[1]));
  return { code, output: output.join("\n"), installDependencies };
}

describe("vanillasky init", () => {
  it("preserves the exact tarball when npx initializes a blank folder", async () => {
    const cwd = blankProject();
    vi.stubEnv("npm_config_package", "/private/tmp/vanillaskyai-video-candidate.tgz");

    const result = await run(cwd, ["init"]);

    expect(result.code, result.output).toBe(0);
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    expect(manifest.dependencies["@vanillaskyai/video"])
      .toBe("file:/private/tmp/vanillaskyai-video-candidate.tgz");
  });

  it("creates a runnable thin video-chat app with only baseline dependencies", async () => {
    const cwd = project();

    const result = await run(cwd, ["init"]);

    expect(result.code, result.output).toBe(0);
    expect(result.installDependencies).toHaveBeenCalledOnce();
    expect(result.installDependencies).toHaveBeenCalledWith(cwd);
    expect(result.output).toContain("MISSING  ANTHROPIC_API_KEY in .env.local");
    expect(result.output).toContain("READY    templates + browser voice");
    expect(result.output).toContain("npm run dev");

    for (const path of [
      ".env.example",
      ".env.local",
      ".gitignore",
      "README.md",
      "index.html",
      "server.ts",
      "src/main.tsx",
      "stock.ts",
      "tsconfig.json",
      "vite.config.ts",
    ]) expect(existsSync(join(cwd, path)), path).toBe(true);
    expect(existsSync(join(cwd, "vanillasky"))).toBe(false);
    expect(readFileSync(join(cwd, ".env.local"), "utf8"))
      .toBe(readFileSync(join(cwd, ".env.example"), "utf8"));
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toContain(".env.local");

    const client = readFileSync(join(cwd, "src/main.tsx"), "utf8");
    expect(client).toContain("<VideoChat");
    expect(client).toContain('@vanillaskyai/video/video-chat.css');
    expect(client).not.toContain("../vanillasky");
    expect(client).not.toContain("createTemplateRegistry");
    const server = readFileSync(join(cwd, "server.ts"), "utf8");
    expect(server).toContain("createVideoChatHandler");
    expect(server).not.toContain("./vanillasky/server");
    expect(server).not.toContain("import.meta.env");

    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    expect(manifest.dependencies["@vanillaskyai/video"]).toBe("^0.6.0");
    expect(manifest.dependencies).toMatchObject({
      "@ai-sdk/anthropic": expect.any(String),
      ai: expect.any(String),
      react: expect.any(String),
      "react-dom": expect.any(String),
    });
    expect(manifest.dependencies).not.toHaveProperty("@ai-sdk/xai");
    expect(manifest.dependencies).not.toHaveProperty("@fal-ai/client");
    expect(existsSync(join(cwd, "providers.ts"))).toBe(true);
    expect(manifest.devDependencies).toMatchObject({
      "@types/node": expect.any(String),
      "@types/react": expect.any(String),
      "@types/react-dom": expect.any(String),
      "@vitejs/plugin-react": expect.any(String),
      typescript: expect.any(String),
      vite: expect.any(String),
    });
    expect(manifest.scripts).toMatchObject({ dev: "vite", build: "tsc && vite build", preview: "vite preview" });
  });

  it("refuses conflicting application files before writing anything", async () => {
    const cwd = project();
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src/main.tsx"), "customer app\n");

    const before = readdirSync(cwd).sort();
    const result = await run(cwd, ["init"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("src/main.tsx already exists");
    expect(result.installDependencies).not.toHaveBeenCalled();
    expect(readFileSync(join(cwd, "src/main.tsx"), "utf8")).toBe("customer app\n");
    expect(readdirSync(cwd).sort()).toEqual(before);
    expect(existsSync(join(cwd, "server.ts"))).toBe(false);
  });

  it("refuses to replace existing application scripts", async () => {
    const cwd = project();
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    manifest.scripts = { dev: "next dev", test: "vitest" };
    writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest, null, 2));
    const before = readFileSync(join(cwd, "package.json"), "utf8");

    const result = await run(cwd, ["init"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("package.json script dev already exists");
    expect(result.installDependencies).not.toHaveBeenCalled();
    expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe(before);
    expect(existsSync(join(cwd, "src"))).toBe(false);
  });

  it("treats an existing empty application script as an owned conflict", async () => {
    const cwd = project();
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    manifest.scripts = { dev: "" };
    writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest, null, 2));

    const result = await run(cwd, ["init"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("package.json script dev already exists");
    expect(result.installDependencies).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, "src"))).toBe(false);
  });

  it("refuses to change an existing package module type", async () => {
    const cwd = project();
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    manifest.type = "commonjs";
    writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest, null, 2));
    const before = readFileSync(join(cwd, "package.json"), "utf8");

    const result = await run(cwd, ["init"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("package.json type commonjs is incompatible");
    expect(result.installDependencies).not.toHaveBeenCalled();
    expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe(before);
    expect(existsSync(join(cwd, "src"))).toBe(false);
  });

  it("is repeatable without replacing an edited local environment", async () => {
    const cwd = project();
    await run(cwd, ["init"]);
    writeFileSync(join(cwd, ".env.local"), "ANTHROPIC_API_KEY=kept-private\n");
    const installDependencies = vi.fn(async () => undefined);

    const result = await run(cwd, ["init"], installDependencies);

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("already initialized");
    expect(installDependencies).toHaveBeenCalledOnce();
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toBe("ANTHROPIC_API_KEY=kept-private\n");
  });

  it("keeps a complete scaffold and gives a recovery command when install fails", async () => {
    const cwd = project();
    const result = await run(cwd, ["init"], vi.fn(async () => {
      throw new Error("registry unavailable");
    }));

    expect(result.code).toBe(1);
    expect(result.output).toContain("registry unavailable");
    expect(result.output).toContain("run npm install to finish setup");
    expect(existsSync(join(cwd, "src/main.tsx"))).toBe(true);
    expect(existsSync(join(cwd, ".env.local"))).toBe(true);
  });

  it("retries installation after failure without replacing local settings or provider registration", async () => {
    const cwd = project();
    await run(cwd, ["init"], vi.fn(async () => { throw new Error("interrupted"); }));
    writeFileSync(join(cwd, ".env.local"), "ANTHROPIC_API_KEY=private-value\n");
    writeFileSync(join(cwd, "providers.ts"), "export const providers = { custom: true };\n");
    const result = await run(cwd, ["init"]);
    expect(result.code, result.output).toBe(0);
    expect(result.installDependencies).toHaveBeenCalledOnce();
    expect(readFileSync(join(cwd, "providers.ts"), "utf8")).toContain("custom: true");
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain("private-value");
    expect(result.output).not.toContain("private-value");
  });

  it("rejects symbolic-link traversal before writing the scaffold", async () => {
    const cwd = project();
    const outside = mkdtempSync(join(tmpdir(), "vanillasky-init-outside-"));
    fixtures.push(outside);
    symlinkSync(outside, join(cwd, "src"));

    const result = await run(cwd, ["init"]);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/symbolic link/i);
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(cwd, "server.ts"))).toBe(false);
  });

  it("rejects unknown arguments without changing the project", async () => {
    const cwd = project();
    const before = readFileSync(join(cwd, "package.json"), "utf8");

    const result = await run(cwd, ["init", "another-directory"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("Unexpected init argument");
    expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe(before);
    expect(existsSync(join(cwd, "src"))).toBe(false);
  });

  it("makes the final matching gitignore rule protect the local environment", async () => {
    const cwd = project();
    writeFileSync(join(cwd, ".gitignore"), ".env.local\n!.env.local\n");

    const result = await run(cwd, ["init"]);

    expect(result.code, result.output).toBe(0);
    const rules = readFileSync(join(cwd, ".gitignore"), "utf8").trim().split("\n");
    expect(rules.filter((rule) => rule.endsWith(".env.local")).at(-1)).toBe(".env.local");
  });

  it("protects the local environment after a broad negation", async () => {
    const cwd = project();
    writeFileSync(join(cwd, ".gitignore"), ".env.local\n!.env*\n");

    const result = await run(cwd, ["init"]);

    expect(result.code, result.output).toBe(0);
    expect(readFileSync(join(cwd, ".gitignore"), "utf8").trim().split("\n").at(-1)).toBe(".env.local");
  });
});

describe("vanillasky doctor", () => {
  it("reports a JSON package manifest that is not an object", async () => {
    const cwd = project();
    writeFileSync(join(cwd, "package.json"), "null\n");

    const result = await run(cwd, ["doctor"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("MISSING  valid package.json");
  });

  it("reports the one required key and optional capability fallbacks", async () => {
    const cwd = project();
    await run(cwd, ["init"]);

    const missing = await run(cwd, ["doctor"]);
    expect(missing.code).toBe(1);
    expect(missing.output).toContain("MISSING  ANTHROPIC_API_KEY");
    expect(missing.output).toContain("READY    templates + browser voice");
    expect(missing.output).toContain("OPTIONAL generated video");
    expect(missing.output).not.toContain("kept-private");

    writeFileSync(join(cwd, ".env.local"), [
      "ANTHROPIC_API_KEY=kept-private",
      "FAL_KEY=also-private",
      "",
    ].join("\n"));
    const ready = await run(cwd, ["doctor"]);
    expect(ready.code, ready.output).toBe(0);
    expect(ready.output).toContain("READY    ANTHROPIC_API_KEY");
    expect(ready.output).toContain("npx vanillasky providers add video");
    expect(ready.output).not.toContain("READY    generated video");
    expect(ready.output).not.toContain("kept-private");
    expect(ready.output).not.toContain("also-private");
  });

  it("detects declared dependencies whose installation was interrupted", async () => {
    const cwd = project();
    await run(cwd, ["init"], vi.fn(async () => undefined));
    writeFileSync(join(cwd, ".env.local"), "ANTHROPIC_API_KEY=private-value\n");
    const result = await run(cwd, ["doctor"]);
    expect(result.code).toBe(1);
    expect(result.output).toContain("NOT INSTALLED  @ai-sdk/anthropic");
    expect(result.output).toContain("npm install");
    expect(result.output).not.toContain("private-value");
  });

  it("requires registration, adapter, installed dependency, and key for optional readiness", async () => {
    const cwd = project();
    await run(cwd, ["init"]);
    writeFileSync(join(cwd, ".env.local"), "ANTHROPIC_API_KEY=private\nXAI_API_KEY=private-speech\n");
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    manifest.vanillasky = { providers: ["speech"] };
    manifest.dependencies["@ai-sdk/xai"] = "^3.0.0";
    writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest));
    mkdirSync(join(cwd, "providers"));
    writeFileSync(join(cwd, "providers/speech.ts"), "export const speech = {};\n");
    const missing = await run(cwd, ["doctor"]);
    expect(missing.output).not.toContain("READY    generated speech");
    markInstalled(cwd);
    const ready = await run(cwd, ["doctor"]);
    expect(ready.code, ready.output).toBe(0);
    expect(ready.output).toContain("READY    generated speech");
    expect(ready.output).not.toContain("private-speech");
  });

  it("detects client-exposed provider keys", async () => {
    const cwd = project();
    await run(cwd, ["init"]);
    writeFileSync(join(cwd, ".env.local"), [
      "ANTHROPIC_API_KEY=private",
      "VITE_FAL_KEY=public-by-mistake",
      "",
    ].join("\n"));

    const result = await run(cwd, ["doctor"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("UNSAFE   VITE_FAL_KEY");
    expect(result.output).not.toContain("public-by-mistake");
  });

  it("fails when a later gitignore rule re-includes the secret file", async () => {
    const cwd = project();
    await run(cwd, ["init"]);
    writeFileSync(join(cwd, ".env.local"), "ANTHROPIC_API_KEY=private\n");
    writeFileSync(join(cwd, ".gitignore"), ".env.local\n!.env.local\n");

    const result = await run(cwd, ["doctor"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("UNSAFE   .env.local is not ignored");
    expect(result.output).not.toContain("private");
  });

  it("fails when a later broad gitignore rule re-includes the secret file", async () => {
    const cwd = project();
    await run(cwd, ["init"]);
    writeFileSync(join(cwd, ".env.local"), "ANTHROPIC_API_KEY=private\n");
    writeFileSync(join(cwd, ".gitignore"), ".env.local\n!.env*\n");

    const result = await run(cwd, ["doctor"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("UNSAFE   .env.local is not ignored");
    expect(result.output).not.toContain("private");
  });
});

describe("vanillasky templates namespace", () => {
  it("keeps app commands at the root and moves template operations under templates", async () => {
    const cwd = project();
    const help = await run(cwd, ["help"]);
    expect(help.output).toContain("vanillasky init");
    expect(help.output).toContain("vanillasky doctor");
    expect(help.output).toContain("vanillasky templates list");

    const namespaced = await run(cwd, ["templates", "list", "--builtin", "--json"]);
    expect(namespaced.code).toBe(0);
    expect(JSON.parse(namespaced.output)).toContainEqual(expect.objectContaining({ id: "keyFigure" }));

    const removed = await run(cwd, ["list"]);
    expect(removed.code).toBe(1);
    expect(removed.output).toContain("vanillasky templates list");
  });
});
