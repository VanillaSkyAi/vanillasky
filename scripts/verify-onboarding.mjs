#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
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
    || !initialization.output.includes("browser voice")) {
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
  if (!existsSync(join(app, "providers.ts")) || !existsSync(join(app, "providers/text.ts"))) {
    throw new Error("Baseline init must install its app-owned text callback and optional-provider wiring");
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
  if (JSON.stringify(Object.fromEntries(Object.entries(initializedCapabilities).filter(([key]) => key !== "templates"))) !== JSON.stringify({
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
      yield JSON.stringify({ type: "answer", intent: "informational",
        opening: "Let us explore the Moon.", subject: "moon",
        development: "", visualDirection: "Clear orbital illustration.",
        ending: { narration: followUp ? "Walk around a friend while facing them." : "The Moon rotates once per orbit.",
          subject: "moon", action: "Show rotation matching an orbit.", durationSec: 3, continuity: "cut" },
      }) + "\n";
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
  const editedSpeech = `${readFileSync(speechAdapter, "utf8")}\n// Customer-owned speech adapter customization.\n`;
  writeFileSync(speechAdapter, editedSpeech);
  rmSync(join(app, "node_modules", "@ai-sdk/xai"), { recursive: true, force: true });
  runCli(["providers", "add", "speech"]);
  if (readFileSync(speechAdapter, "utf8") !== editedSpeech
    || !existsSync(join(app, "node_modules", "@ai-sdk/xai", "package.json"))) {
    throw new Error("Repeated speech upgrade lost customer source or failed to repair installation");
  }
  runCli(["providers", "add", "video", "fal"]);
  const videoManifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  if (existsSync(join(app, "node_modules", "@fal-ai/client"))
    || videoManifest.vanillasky.videoVendor !== "fal"
    || videoManifest.vanillasky.providers.includes("transcription")
    || readFileSync(speechAdapter, "utf8") !== editedSpeech) {
    throw new Error("Video upgrade changed unrelated capabilities, lost app source, or installed a vendor SDK");
  }
  runCli(["providers", "add", "transcription"]);
  const optionalCanaries = ["server-only-speech-canary", "server-only-video-canary", "server-only-storage-canary"];
  const upgradedEnvironment = `ANTHROPIC_API_KEY=${textKeyCanary}\nXAI_API_KEY=${optionalCanaries[0]}\nFAL_KEY=${optionalCanaries[1]}\nVIDEO_UPLOAD_URL=https://storage.example/upload\nVIDEO_STORAGE_TOKEN=${optionalCanaries[2]}\n`;
  writeFileSync(environmentPath, upgradedEnvironment);
  const upgradedDoctor = runCli(["doctor"]);
  if (!upgradedDoctor.output.includes("READY    generated speech")
    || !upgradedDoctor.output.includes("READY    generated video (fal")
    || !upgradedDoctor.output.includes("READY    transcription")
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

  // Prove the no-framework path from the same immutable artifact in another
  // independent consumer. Native HTTP payloads are covered by offline adapter tests.
  const nativeApp = join(workspace, "native-video-demo");
  mkdirSync(nativeApp);
  runCapture("npx", ["--yes", "--package", installSpec, "vanillasky", "init", "--native"], nativeApp);
  const nativeCli = join(nativeApp, "node_modules/@vanillaskyai/video/bin/vanillasky.js");
  runCapture(process.execPath, [nativeCli, "init"], nativeApp);
  const nativeManifest = JSON.parse(readFileSync(join(nativeApp, "package.json"), "utf8"));
  for (const dependency of ["ai", "@ai-sdk/anthropic", "@fal-ai/client"]) {
    if (nativeManifest.dependencies?.[dependency] || existsSync(join(nativeApp, "node_modules", dependency))) {
      throw new Error(`Native init unexpectedly required ${dependency}`);
    }
  }
  const nativeKey = "server-only-native-text-canary";
  writeFileSync(join(nativeApp, ".env.local"), `GEMINI_API_KEY=${nativeKey}\n`);
  const nativeDoctor = runCapture(process.execPath, [nativeCli, "doctor"], nativeApp);
  if (!nativeDoctor.output.includes("READY    GEMINI_API_KEY") || nativeDoctor.output.includes(nativeKey)) {
    throw new Error("Native doctor did not report readiness without exposing credentials");
  }
  run("npm", ["run", "build"], nativeApp);
  const nativeBundle = readdirSync(join(nativeApp, "dist"), { recursive: true })
    .map(path => join(nativeApp, "dist", path)).filter(path => !statSync(path).isDirectory())
    .map(path => readFileSync(path, "utf8")).join("\n");
  if (nativeBundle.includes(nativeKey)) throw new Error("Native text credentials entered the browser bundle");

  for (const [path, original] of Object.entries(tsconfigSnapshot)) {
    if (readFileSync(join(app, path), "utf8") !== original) throw new Error("Onboarding changed strict TypeScript settings");
  }
  if (evidenceDirectory) {
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, "verification.json"), JSON.stringify({
      package: installSpec,
      integrity: candidateArtifact?.integrity ?? process.env.VANILLASKY_EXPECTED_INTEGRITY,
      sha256: candidateArtifact?.sha256 ?? process.env.VANILLASKY_EXPECTED_SHA256,
      browserErrors: welcomeErrors,
      responseCount: responseRequests.length,
      result: "default chat, follow-up context, independent providers and native/AI-SDK strict builds passed",
    }, null, 2) + "\n");
  }
  console.log("Fresh Vite onboarding passed: exact candidate, native and AI-SDK strict builds, default chat, follow-up context, independent provider upgrades, installation recovery and secret isolation.");
} finally {
  if (welcomeBrowser) await welcomeBrowser.close();
  if (welcomeServer) {
    welcomeServer.kill("SIGTERM");
    welcomeServer.stdout?.destroy();
    welcomeServer.stderr?.destroy();
  }
  if (evidenceDirectory) {
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, "commands.log"), commandLog.join("\n") + "\n");
  }
  rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
