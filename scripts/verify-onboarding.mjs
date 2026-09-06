#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { parseNpmPackJson } from "./lib/parse-npm-pack-json.mjs";
import { selectPackedArtifact } from "./lib/release-integrity.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SERVER_START_TIMEOUT_MS = 30_000;
const workspace = mkdtempSync(join(tmpdir(), "vanillasky-onboarding-"));
const app = join(workspace, "video-demo");
const evidenceDirectory = process.env.VANILLASKY_EVIDENCE_DIR ? resolve(process.env.VANILLASKY_EVIDENCE_DIR) : undefined;
const commandLog = [];
const commandEnvironment = () => ({ ...process.env, npm_config_cache: join(workspace, "npm-cache") });
const run = (command, args, cwd) => {
  commandLog.push(`${cwd}$ ${command} ${args.join(" ")}`);
  return execFileSync(command, args, { cwd, stdio: "inherit", env: commandEnvironment() });
};
const runCapture = (command, args, cwd, { expectFailure = false } = {}) => {
  commandLog.push(`${cwd}$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: commandEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!expectFailure && result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}\n${output}`);
  }
  return { status: result.status, output };
};
let cli;
const runCli = (args, options) => runCapture(process.execPath, [cli, ...args], app, options);

function hashTree(directory, excludedTopLevel = new Set()) {
  const hash = createHash("sha256");
  const visit = (current, prefix = "") => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!prefix && excludedTopLevel.has(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(current, entry.name);
      hash.update(entry.isDirectory() ? `directory:${path}\0` : `file:${path}\0`);
      if (entry.isDirectory()) visit(absolute, path);
      else hash.update(readFileSync(absolute));
    }
  };
  if (existsSync(directory)) visit(directory);
  return hash.digest("hex");
}
const generatedHash = () => hashTree(join(app, "vanillasky"));
const projectHash = () => hashTree(app, new Set([".git", "dist", "node_modules"]));

function parseCreatedPreviewDiff(output) {
  const lines = output.replaceAll("\r\n", "\n").split("\n");
  const files = new Map();
  for (let index = 0; index < lines.length;) {
    if (!lines[index].startsWith("--- ")) {
      index += 1;
      continue;
    }
    const path = lines[index].slice(4);
    if (lines[index + 1] !== `+++ ${path}` || !lines[index + 2]?.startsWith("@@ ")) {
      throw new Error(`Could not parse packed add preview for ${path}`);
    }
    index += 3;
    const after = [];
    while (index < lines.length && !lines[index].startsWith("--- ")) {
      const line = lines[index];
      if (line.startsWith("-")) {
        throw new Error(`Expected clean-project preview to create ${path}, but it removes existing bytes`);
      }
      if (line.startsWith("+")) after.push(line.slice(1));
      else if (line !== "") throw new Error(`Unexpected packed add preview line for ${path}: ${line}`);
      index += 1;
    }
    files.set(path, after.join("\n"));
  }
  return files;
}

function assertProjectImports() {
  const sourceRoot = join(app, "vanillasky");
  const allowedSdkImports = new Set(["@vanillaskyai/video/templates", "@vanillaskyai/video/server"]);
  const allowedExternalImports = new Set(["react", "react/jsx-runtime"]);
  const sourceFiles = readdirSync(sourceRoot, { recursive: true })
    .filter((path) => typeof path === "string" && /\.(?:ts|tsx)$/.test(path))
    .map((path) => join(sourceRoot, path));
  const resolveRelativeImport = (source, specifier) => {
    const base = resolve(dirname(source), specifier);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
    if (!candidates.some((candidate) => existsSync(candidate))) {
      throw new Error(`Generated source has an unresolved relative import: ${relative(app, source)} -> ${specifier}`);
    }
    const fromRoot = relative(sourceRoot, base);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      throw new Error(`Generated source imports outside the customer-owned tree: ${relative(app, source)} -> ${specifier}`);
    }
  };
  for (const source of sourceFiles) {
    const contents = readFileSync(source, "utf8");
    const specifiers = [...contents.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)]
      .map((match) => match[1]);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) {
        resolveRelativeImport(source, specifier);
      } else if (specifier.startsWith("@vanillaskyai/video")) {
        if (!allowedSdkImports.has(specifier)) {
          throw new Error(`Generated source uses an undocumented SDK import: ${relative(app, source)} -> ${specifier}`);
        }
      } else if (!allowedExternalImports.has(specifier)) {
        throw new Error(`Generated source uses an unexpected external import: ${relative(app, source)} -> ${specifier}`);
      }
    }
  }
}
let server;
let browser;
let welcomeServer;
let welcomeBrowser;

try {
  mkdirSync(app);
  let installSpec = process.env.VANILLASKY_INSTALL_SPEC;
  let candidateArtifact;
  if (!installSpec) {
    candidateArtifact = selectPackedArtifact({
      providedPath: process.env.VANILLASKY_PACKED_TARBALL
        ? resolve(process.env.VANILLASKY_PACKED_TARBALL)
        : undefined,
      expectedIntegrity: process.env.VANILLASKY_EXPECTED_INTEGRITY,
      expectedSha256: process.env.VANILLASKY_EXPECTED_SHA256,
      packArtifact: () => {
        run("npm", ["run", "build"], root);
        const [packed] = parseNpmPackJson(execFileSync("npm", [
          "pack", "--silent", "--json", "--ignore-scripts", "--pack-destination", workspace,
        ], { cwd: root, encoding: "utf8" }));
        return { path: join(workspace, packed.filename), integrity: packed.integrity };
      },
    });
    installSpec = candidateArtifact.path;
  }
  const initialization = runCapture("npx", ["--yes", "--package", installSpec, "vanillasky", "init"], app);
  console.log(initialization.output);
  if (!initialization.output.includes("MISSING  ANTHROPIC_API_KEY")
    || !initialization.output.includes("READY    templates + browser voice")) {
    throw new Error("Packed init did not run doctor automatically with one required key");
  }
  cli = join(app, "node_modules", "@vanillaskyai", "video", "bin", "vanillasky.js");
  if (!existsSync(cli)) throw new Error("Scoped npx init did not install the VanillaSky CLI in the generated app");
  const initializedManifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  if (isAbsolute(installSpec) && initializedManifest.dependencies?.["@vanillaskyai/video"] !== `file:${installSpec}`) {
    throw new Error("Scoped npx init did not preserve the exact packed candidate dependency");
  }
  if (existsSync(join(app, "vanillasky"))) throw new Error("Default onboarding unexpectedly copied templates");
  for (const dependency of ["@ai-sdk/xai", "@fal-ai/client"]) {
    if (initializedManifest.dependencies?.[dependency] || existsSync(join(app, "node_modules", dependency))) {
      throw new Error(`Baseline init unexpectedly installed optional provider ${dependency}`);
    }
  }
  if (!existsSync(join(app, "providers.ts")) || existsSync(join(app, "providers"))) {
    throw new Error("Baseline init must copy only the empty provider registry");
  }
  const generatedClient = readFileSync(join(app, "src", "main.tsx"), "utf8");
  const generatedServer = readFileSync(join(app, "server.ts"), "utf8");
  if (!generatedClient.includes("<VideoChat") || generatedClient.includes("../vanillasky")) {
    throw new Error("Packed init did not create the thin SDK-owned VideoChat shell");
  }
  if (generatedServer.includes("./vanillasky/server")) {
    throw new Error("Packed init copied a source-owned template registry into the default server");
  }
  const missingDoctor = runCli(["doctor"], { expectFailure: true });
  if (missingDoctor.status === 0 || !missingDoctor.output.includes("MISSING  ANTHROPIC_API_KEY")) {
    throw new Error(`Packed doctor did not report the missing required key:\n${missingDoctor.output}`);
  }
  const textKeyCanary = "server-only-anthropic-canary";
  writeFileSync(join(app, ".env.local"), `ANTHROPIC_API_KEY=${textKeyCanary}\n`);
  const readyDoctor = runCli(["doctor"]);
  if (!readyDoctor.output.includes("READY    ANTHROPIC_API_KEY") || readyDoctor.output.includes(textKeyCanary)) {
    throw new Error(`Packed doctor did not report readiness without exposing the key:\n${readyDoctor.output}`);
  }
  run("npm", ["run", "build"], app);
  const bundledClient = readdirSync(join(app, "dist"), { recursive: true })
    .filter((path) => typeof path === "string")
    .map((path) => join(app, "dist", path))
    .filter((path) => !statSync(path).isDirectory())
    .map((path) => readFileSync(path))
    .map((contents) => contents.toString("utf8"))
    .join("\n");
  if (bundledClient.includes(textKeyCanary)) throw new Error("Packed init exposed the server key in the browser bundle");

  let welcomeServerOutput = "";
  const viteCli = join(app, "node_modules", "vite", "bin", "vite.js");
  welcomeServer = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", "4174", "--strictPort"], {
    cwd: app,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const captureWelcomeOutput = (chunk) => { welcomeServerOutput = `${welcomeServerOutput}${chunk}`.slice(-8_000); };
  welcomeServer.stdout.on("data", captureWelcomeOutput);
  welcomeServer.stderr.on("data", captureWelcomeOutput);
  const welcomeDeadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < welcomeDeadline) {
    try { if ((await fetch("http://127.0.0.1:4174/")).ok) break; } catch { /* starting */ }
    if (welcomeServer.exitCode != null) {
      throw new Error(`Initialized Vite server exited with code ${welcomeServer.exitCode}:\n${welcomeServerOutput}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  welcomeBrowser = await chromium.launch();
  const welcomeContext = await welcomeBrowser.newContext({ reducedMotion: "no-preference" });
  const welcomePage = await welcomeContext.newPage();
  const welcomeErrors = [];
  welcomePage.on("console", (message) => { if (message.type() === "error") welcomeErrors.push(message.text()); });
  welcomePage.on("pageerror", (error) => welcomeErrors.push(error.message));
  await welcomePage.goto("http://127.0.0.1:4174/");
  await welcomePage.getByRole("heading", { name: /responds in video, not text/i }).waitFor();
  await welcomePage.getByPlaceholder("Ask anything…").waitFor();
  const initializedCapabilities = await welcomePage.evaluate(async () =>
    fetch("/api/video-chat?action=capabilities").then((response) => response.json()));
  if (JSON.stringify(initializedCapabilities) !== JSON.stringify({
    templates: true,
    generatedSpeech: false,
    generatedVideo: false,
    stockMedia: false,
    transcription: false,
    modes: ["cinematic"],
  })) throw new Error(`Initialized capability fallback drifted: ${JSON.stringify(initializedCapabilities)}`);
  // Exercise the unchanged initialized UI with the exact installed server package.
  const { createVideoChatHandler } = await import(pathToFileURL(join(app, "node_modules/@vanillaskyai/video/dist/server.js")).href);
  const responseRequests = [];
  const mockedChat = createVideoChatHandler({
    authorize: "none", heartbeatMs: false,
    streamText: ({ userPrompt }) => (async function* () {
      const followUp = userPrompt.includes("Give me an analogy");
      yield JSON.stringify({ type: "video-chat.opening", spokenHook: "Let us explore the Moon.", mediaKeyword: "moon" }) + "\n";
      yield JSON.stringify({ type: "scene.add", placement: "closer", scene: {
        id: followUp ? "analogy" : "moon", templateId: "chapterTitle",
        variables: { title: followUp ? "An orbital dance" : "Always facing Earth" },
        narration: followUp ? "Walk around a friend while facing them." : "The Moon rotates once per orbit.",
        timing: { fixedDuration: 3 },
      } }) + "\n";
      yield JSON.stringify({ type: "plan.complete" }) + "\n";
    })(),
    generateText: async ({ task }) => task === "suggestions" ? "[]" : "The Moon rotates once per orbit.",
  });
  await welcomePage.route("**/api/video-chat**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).searchParams.get("action") === "response") responseRequests.push(request.postDataJSON());
    const response = await mockedChat(new Request(request.url(), {
      method: request.method(), headers: request.headers(), ...(request.method() === "POST" ? { body: request.postData() } : {}),
    }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  await welcomePage.getByRole("button", { name: "Turn the voice off", exact: true }).click();
  await welcomePage.getByPlaceholder("Ask anything…").fill("Why does the Moon show one face?");
  await welcomePage.getByRole("button", { name: "Ask", exact: true }).click();
  await welcomePage.getByText("The Moon rotates once per orbit.", { exact: true }).first().waitFor();
  await welcomePage.locator(".vanillasky-video-chat").hover();
  await welcomePage.locator("textarea").fill("Give me an analogy");
  await welcomePage.getByRole("button", { name: "Ask", exact: true }).click();
  await welcomePage.getByText("Walk around a friend while facing them.", { exact: true }).first().waitFor();
  if (responseRequests.length !== 2 || !JSON.stringify(responseRequests[1].conversation).includes("Why does the Moon show one face?")) {
    throw new Error("Initialized chat did not retain follow-up context");
  }
  if (welcomeErrors.length) throw new Error(`Initialized browser errors: ${welcomeErrors.join(" | ")}`);
  await welcomeBrowser.close();
  welcomeBrowser = undefined;
  welcomeServer.kill("SIGTERM");
  welcomeServer.stdout?.destroy();
  welcomeServer.stderr?.destroy();
  welcomeServer = undefined;
  const tsconfigPaths = ["tsconfig.json", "tsconfig.app.json", "tsconfig.node.json"]
    .filter((path) => existsSync(join(app, path)));
  const tsconfigSnapshot = Object.fromEntries(tsconfigPaths.map((path) => [path, readFileSync(join(app, path), "utf8")]));
  const strictSettings = Object.values(tsconfigSnapshot).join("\n");
  for (const setting of ['"noEmit": true', '"noUnusedLocals": true', '"noUnusedParameters": true']) {
    if (!strictSettings.includes(setting)) throw new Error(`Current Vite React TypeScript scaffold is missing ${setting}`);
  }

  // Upgrade the same exact installed starter only after the initial browser
  // session stops. These checks compile adapters; they never call providers.
  const speechAdapter = join(app, "providers", "speech.ts");
  const registryPath = join(app, "providers.ts");
  const environmentPath = join(app, ".env.local");
  runCli(["providers", "add", "speech"]);
  if (!existsSync(join(app, "node_modules", "@ai-sdk/xai", "package.json"))
    || existsSync(join(app, "node_modules", "@fal-ai/client"))) {
    throw new Error("Speech upgrade did not install only its selected provider");
  }
  run("npm", ["run", "build"], app);
  const editedSpeech = `${readFileSync(speechAdapter, "utf8")}\n// Customer-owned speech adapter customization.\n`;
  writeFileSync(speechAdapter, editedSpeech);
  rmSync(join(app, "node_modules", "@ai-sdk/xai"), { recursive: true, force: true });
  runCli(["providers", "add", "speech"]);
  if (readFileSync(speechAdapter, "utf8") !== editedSpeech
    || !existsSync(join(app, "node_modules", "@ai-sdk/xai", "package.json"))) {
    throw new Error("Repeated speech upgrade lost customer source or failed to repair installation");
  }
  runCli(["providers", "add", "video"]);
  if (!existsSync(join(app, "node_modules", "@fal-ai/client", "package.json"))
    || readFileSync(speechAdapter, "utf8") !== editedSpeech) {
    throw new Error("Video upgrade lost the speech customization or failed to install");
  }
  run("npm", ["run", "build"], app);
  const optionalCanaries = ["server-only-speech-canary", "server-only-video-canary"];
  const upgradedEnvironment = `ANTHROPIC_API_KEY=${textKeyCanary}\nXAI_API_KEY=${optionalCanaries[0]}\nFAL_KEY=${optionalCanaries[1]}\n`;
  writeFileSync(environmentPath, upgradedEnvironment);
  const upgradedDoctor = runCli(["doctor"]);
  if (!upgradedDoctor.output.includes("READY    generated speech")
    || !upgradedDoctor.output.includes("READY    generated video + transcription")
    || [textKeyCanary, ...optionalCanaries].some((key) => upgradedDoctor.output.includes(key))) {
    throw new Error("Doctor did not recognize the installed upgrades without exposing keys");
  }
  const upgradedRegistry = readFileSync(registryPath, "utf8");
  rmSync(join(app, "node_modules", "@ai-sdk/anthropic"), { recursive: true, force: true });
  const repeatedInit = runCli(["init"]);
  if (!repeatedInit.output.includes("READY    ANTHROPIC_API_KEY")
    || !existsSync(join(app, "node_modules", "@ai-sdk/anthropic", "package.json"))
    || readFileSync(environmentPath, "utf8") !== upgradedEnvironment
    || readFileSync(registryPath, "utf8") !== upgradedRegistry
    || readFileSync(speechAdapter, "utf8") !== editedSpeech) {
    throw new Error("Repeated init failed to repair installation while preserving environment and providers");
  }
  run("npm", ["run", "build"], app);
  const upgradedClient = readdirSync(join(app, "dist"), { recursive: true })
    .map((path) => join(app, "dist", path))
    .filter((path) => !statSync(path).isDirectory())
    .map((path) => readFileSync(path, "utf8")).join("\n");
  if ([textKeyCanary, ...optionalCanaries].some((key) => upgradedClient.includes(key))) {
    throw new Error("Optional provider setup exposed server keys in the browser bundle");
  }
  // Keep subsequent local template previews on the zero-provider baseline.
  writeFileSync(environmentPath, `ANTHROPIC_API_KEY=${textKeyCanary}\n`);

  run("npm", ["install", "--no-audit", "--no-fund", "--save-dev", "tsx@4.23.12"], app);
  const builtinList = runCli(["templates", "list", "--builtin", "--json"]).output;
  if (!JSON.parse(builtinList).some(({ id }) => id === "keyFigure")) throw new Error("Packed list did not include keyFigure");
  const builtinDescription = JSON.parse(runCli(["templates", "describe", "keyFigure", "--builtin", "--json"]).output);
  if (builtinDescription.id !== "keyFigure") throw new Error("Packed describe returned the wrong template");
  const previewBefore = projectHash();
  const dryRun = runCli(["templates", "add", "keyFigure", "--dry-run"]).output;
  const diff = runCli(["templates", "add", "keyFigure", "--diff"]).output;
  if (projectHash() !== previewBefore) throw new Error("Packed add preview applied a proposed write in the clean-room fixture");
  for (const path of [
    "vanillasky/templates/keyFigure.tsx",
    "vanillasky/index.ts",
    "vanillasky/server.ts",
  ]) {
    if (!dryRun.includes(path) || !diff.includes(path)) throw new Error(`Packed add previews omitted ${path}`);
  }
  const previewAfter = parseCreatedPreviewDiff(diff);
  if (previewAfter.size === 0) throw new Error("Packed add --diff did not expose any proposed after bytes");
  runCli(["templates", "add", "keyFigure"]);
  for (const [path, expected] of previewAfter) {
    const actual = readFileSync(join(app, path), "utf8");
    if (actual !== expected) throw new Error(`Packed add preview bytes did not match the applied file: ${path}`);
  }
  const repeatedAddTreeHash = generatedHash();
  runCli(["templates", "add", "keyFigure"]);
  if (generatedHash() !== repeatedAddTreeHash) {
    throw new Error("Repeating packed add changed the customer-owned template tree");
  }

  writeFileSync(join(app, "src", "App.tsx"), `import { useEffect, useState } from "react";
import { VideoPlayer, useVideoChat } from "@vanillaskyai/video/react";

const stable = (value: unknown): string => Array.isArray(value) ? "[" + value.map(stable).join(",") + "]" : value && typeof value === "object" ? "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stable((value as Record<string, unknown>)[key])).join(",") + "}" : JSON.stringify(value);
const checksum = (value: unknown) => { let hash = 0x811c9dc5; for (const character of stable(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; } return "fnv1a32:" + hash.toString(16).padStart(8, "0"); };
const fetcher: typeof fetch = async (_url, init) => {
  const action = new URL(String(_url), "http://localhost").searchParams.get("action");
  if (action !== "response") return Response.json(action === "capabilities" ? { templates: true, modes: ["cinematic"] } : action === "narration" ? { line: "A useful customer metric." } : { suggestions: [] });
  const request = JSON.parse(String(init?.body));
  const subject = String(request.prompt).split(" ")[0];
  const scene = { id: "result", templateId: "keyFigure", variables: { value: "142", label: subject + "'s quarter" }, timing: { fixedDuration: 10, startTime: 0, endTime: 10 } };
  const style = {};
  const snapshot = { schemaVersion: "0.2", orientation: "portrait", scenes: [scene], style };
  const events = [
    { protocolVersion: "0.6", type: "response.start", eventId: "run:0", runId: "run", sequence: 0, data: { requestId: "fixture", format: { orientation: "portrait" }, style, capabilities: request.capabilities } },
    { protocolVersion: "0.6", type: "scene.add", eventId: "run:1", runId: "run", sequence: 1, data: { scene, position: 0 } },
    { protocolVersion: "0.6", type: "response.complete", eventId: "run:2", runId: "run", sequence: 2, data: { finishReason: "stop", snapshot, checksum: checksum(snapshot) } },
  ];
  return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\\n\\n").join("") + "data: [DONE]\\n\\n", { headers: { "content-type": "text/event-stream", "x-vanillasky-video-stream": "0.6" } });
};

export default function App() {
  const [input, setInput] = useState("Acme completed 142 customer conversations.");
  const video = useVideoChat({ endpoint: "/api/video-chat", fetcher, initialMuted: true });
  const generate = (source: string) => video.ask(source);
  useEffect(() => {
    void generate(input);
  }, []);
  return <main>
    <label>Input <textarea aria-label="Input" value={input} onChange={(event) => setInput(event.target.value)} /></label>
    <button onClick={() => generate(input)}>Generate</button>
    <output data-testid="status">{video.currentTurn?.completed ? "Complete:" + video.currentTurn.video?.scenes.length + ":" + input.split(" ")[0] : video.status + (video.error ? ":" + video.error.message : "")}</output>
    {video.playerProps && <VideoPlayer key={video.playerKey} {...video.playerProps} />}
  </main>;
}
`);
  writeFileSync(join(app, "src", "main.tsx"), `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
`);
  run("npm", ["run", "build"], app);
  let serverOutput = "";
  server = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", "4175", "--strictPort"], {
    cwd: app,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const captureServerOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-8_000);
  };
  server.stdout.on("data", captureServerOutput);
  server.stderr.on("data", captureServerOutput);
  const serverDeadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < serverDeadline) {
    try { if ((await fetch("http://127.0.0.1:4175/")).ok) break; } catch { /* starting */ }
    if (server.exitCode != null) {
      throw new Error(`Clean-room Vite server exited with code ${server.exitCode}:\n${serverOutput}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  try {
    if (!(await fetch("http://127.0.0.1:4175/")).ok) throw new Error("unhealthy response");
  } catch {
    throw new Error(`Clean-room Vite server did not start within ${SERVER_START_TIMEOUT_MS}ms:\n${serverOutput}`);
  }
  browser = await chromium.launch();
  const context = await browser.newContext();
  if (evidenceDirectory) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const waitForStatus = async (expected) => {
    try {
      await page.getByTestId("status").filter({ hasText: expected }).waitFor({ timeout: 10_000 });
    } catch (error) {
      const actual = await page.getByTestId("status").textContent().catch(() => "missing");
      throw new Error(`Expected ${expected}, received ${actual}; browser errors: ${browserErrors.join(" | ") || "none"}`, { cause: error });
    }
  };
  await page.goto("http://127.0.0.1:4175/");
  await waitForStatus("Complete:1:Acme");
  try {
    await page.locator('[data-template-id="keyFigure"]').waitFor({ timeout: 10_000 });
  } catch (error) {
    const player = page.getByTestId("video-player");
    const playerCount = await player.count();
    throw new Error(`Built-in frame did not render; player count=${playerCount}, status=${playerCount ? await player.getAttribute("data-status") : "missing"}, scenes=${playerCount ? await player.getAttribute("data-scenes") : "missing"}, browser errors=${browserErrors.join(" | ") || "none"}, body=${await page.locator("body").innerText()}`, { cause: error });
  }
  await page.getByText("Acme's quarter").waitFor({ timeout: 10_000 });
  await page.getByLabel("Input").fill("Northstar completed 142 customer conversations.");
  await page.getByRole("button", { name: "Generate" }).click();
  await waitForStatus("Complete:1:Northstar");
  await page.getByText("Northstar's quarter").waitFor({ timeout: 10_000 });
  if (browserErrors.length) throw new Error(`Clean-room browser errors: ${browserErrors.join(" | ")}`);
  runCli(["templates", "create", "ownershipProof"]);
  const ownedTemplatePath = join(app, "vanillasky", "templates", "keyFigure.tsx");
  const ownedTemplate = readFileSync(ownedTemplatePath, "utf8");
  const canonicalDescription = "One supplied figure with one short label over relevant media or black.";
  const customerDescription = "A customer-owned acceptance edit for a personalized metric.";
  if (!ownedTemplate.includes(canonicalDescription)) throw new Error("Could not locate the copied template description to edit");
  writeFileSync(ownedTemplatePath, ownedTemplate.replace(canonicalDescription, customerDescription));

  for (const generated of ["index.ts", "server.ts"]) {
    const path = join(app, "vanillasky", generated);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n// deliberate acceptance drift\n`);
  }
  const drift = runCli(["templates", "sync", "--check"], { expectFailure: true });
  if (drift.status === 0) throw new Error("Expected sync --check to detect deliberate drift");
  if (!drift.output.includes("Generated template files are out of date")) {
    throw new Error(`Packed sync --check returned the wrong drift diagnostic:\n${drift.output}`);
  }
  runCli(["templates", "sync"]);
  if (!readFileSync(join(app, "vanillasky", "server.ts"), "utf8").includes(customerDescription)) {
    throw new Error("Packed sync did not regenerate server metadata from edited customer source");
  }
  if (!readFileSync(join(app, "vanillasky", "index.ts"), "utf8").includes("keyFigureTemplate")) {
    throw new Error("Packed sync did not regenerate the browser registry");
  }
  const serverOnlyConsumer = join(workspace, "server-only-consumer");
  mkdirSync(join(serverOnlyConsumer, "vanillasky"), { recursive: true });
  writeFileSync(join(serverOnlyConsumer, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  run("npm", [
    "install", "--no-audit", "--no-fund", "--omit=peer", "--no-save",
    "typescript@5.9.3", installSpec,
  ], serverOnlyConsumer);
  for (const packagePath of ["react", "react-dom", "@types/react"]) {
    if (existsSync(join(serverOnlyConsumer, "node_modules", packagePath))) {
      throw new Error(`Server-only consumer unexpectedly installed React dependency: ${packagePath}`);
    }
  }
  copyFileSync(join(app, "vanillasky", "server.ts"), join(serverOnlyConsumer, "vanillasky", "server.ts"));
  writeFileSync(join(serverOnlyConsumer, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      types: [],
    },
    include: ["vanillasky/server.ts"],
  }, null, 2)}\n`);
  const serverOnlyTsc = join(serverOnlyConsumer, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [serverOnlyTsc, "--project", "tsconfig.json"], serverOnlyConsumer);
  assertProjectImports();
  writeFileSync(join(app, "src", "template-ownership.ts"), `export { templates as browserTemplates } from "../vanillasky/index";
export { templates as serverTemplates } from "../vanillasky/server";
`);
  run("npm", ["run", "build"], app);
  const tsc = join(app, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [tsc, "--project", "tsconfig.json", "--strict"], app);
  const firstHash = generatedHash();
  runCli(["templates", "sync"]);
  if (generatedHash() !== firstHash) throw new Error("Optional template ownership was not deterministic");
  runCli(["templates", "sync", "--check"]);
  runCli(["templates", "check"]);
  const effectiveList = JSON.parse(runCli(["templates", "list", "--json"]).output);
  if (!effectiveList.some(({ id, origin }) => id === "keyFigure" && origin === "project")) {
    throw new Error("Packed list did not report the copied template as project-owned");
  }
  const effectiveDescription = JSON.parse(runCli(["templates", "describe", "keyFigure", "--json"]).output);
  if (effectiveDescription.summary !== customerDescription) {
    throw new Error("Packed describe did not report the edited customer-owned metadata");
  }
  for (const [path, contents] of Object.entries(tsconfigSnapshot)) {
    if (readFileSync(join(app, path), "utf8") !== contents) {
      throw new Error(`Onboarding changed the untouched Vite TypeScript settings in ${path}`);
    }
  }
  if (evidenceDirectory) {
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: join(evidenceDirectory, "screenshot.png"), fullPage: true });
    await context.tracing.stop({ path: join(evidenceDirectory, "trace.zip") });
    copyFileSync(join(app, "package-lock.json"), join(evidenceDirectory, "package-lock.json"));
    writeFileSync(join(evidenceDirectory, "browser-console.json"), `${JSON.stringify(browserErrors, null, 2)}\n`);
    writeFileSync(join(evidenceDirectory, "verification.json"), `${JSON.stringify({
      package: installSpec,
      integrity: candidateArtifact?.integrity ?? process.env.VANILLASKY_EXPECTED_INTEGRITY ?? null,
      sha256: candidateArtifact?.sha256 ?? process.env.VANILLASKY_EXPECTED_SHA256 ?? null,
      optionalGeneratedTreeSha256: firstHash,
      finalStatus: await page.getByTestId("status").textContent(),
    }, null, 2)}\n`);
  }
  console.log("Fresh Vite onboarding passed exact packed CLI ownership, strict generated-source compilation, automatic doctor, optional provider upgrades, installation recovery, chat defaults, follow-up context, lazy playback, custom-template setup, and browser error checks.");
} finally {
  if (welcomeBrowser) await welcomeBrowser.close();
  if (welcomeServer) {
    welcomeServer.kill("SIGTERM");
    welcomeServer.stdout?.destroy();
    welcomeServer.stderr?.destroy();
  }
  if (browser) await browser.close();
  if (server) {
    server.kill("SIGTERM");
    server.stdout?.destroy();
    server.stderr?.destroy();
  }
  if (evidenceDirectory) {
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, "commands.log"), `${commandLog.join("\n")}\n`);
  }
  try {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (error?.code === "ENOTEMPTY") {
      console.warn(`Temporary workspace cleanup is still in progress: ${workspace}`);
    } else {
      console.error(error);
      process.exitCode = 1;
    }
  }
}
