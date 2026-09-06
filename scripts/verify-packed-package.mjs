#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNpmPackJson } from "./lib/parse-npm-pack-json.mjs";
import { selectPackedArtifact } from "./lib/release-integrity.mjs";
import { verifyPackedMarkdownDocumentation } from "./lib/packed-markdown.mjs";
import { verifyPublicApiSurface } from "./lib/public-api-surface.mjs";
import { chromium } from "playwright";

// Authored chat input; public wire events remain runtime-owned.
function chatPlan(opening, lines, subject = "ocean currents") {
  const shots = lines.map((narration, index) => ({ narration, subject, title: `${subject} ${index === lines.length - 1 ? "conclusion" : "in motion"}`,
    action: `Show ${subject} moving clearly through the frame.`, durationSec: 5, continuity: "cut" }));
  return [
    { type: "answer", intent: "informational", opening, subject,
      development: shots.length > 1 ? "Develop the explanation." : "",
      visualDirection: "Clear illustrative footage.", ending: shots.at(-1) },
    ...shots.slice(0, -1).map((shot) => ({ type: "shot", ...shot })),
  ].map((part) => JSON.stringify(part) + "\n").join("");
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), "vanillasky-packed-consumer-"));
const consumer = join(workspace, "consumer");
const playbackOnlyConsumer = join(workspace, "playback-only-consumer");
const serverConsumer = join(workspace, "server-consumer");
const react19Consumer = join(workspace, "react19-consumer");
const PERSISTED_VIDEO_0_1_0_SHA256 = "eef80e45cd501c3f29a3636d0a0bb34c10da0bf19e205713cedec2bb709bafc4";

try {
  const persistedVideoFixture = readFileSync(
    join(root, "tests", "fixtures", "persisted-video-0.1.0.json"),
    "utf8",
  );
  const persistedVideoFixtureSha256 = createHash("sha256").update(persistedVideoFixture).digest("hex");
  if (persistedVideoFixtureSha256 !== PERSISTED_VIDEO_0_1_0_SHA256) {
    throw new Error("Persisted 0.1.0 release fixture checksum drifted");
  }
  mkdirSync(consumer);
  mkdirSync(playbackOnlyConsumer);
  mkdirSync(serverConsumer);
  mkdirSync(react19Consumer);
  const selectedArtifact = selectPackedArtifact({
    providedPath: process.env.VANILLASKY_PACKED_TARBALL
      ? resolve(process.env.VANILLASKY_PACKED_TARBALL)
      : undefined,
    expectedIntegrity: process.env.VANILLASKY_EXPECTED_INTEGRITY,
    expectedSha256: process.env.VANILLASKY_EXPECTED_SHA256,
    packArtifact: () => {
      const packed = parseNpmPackJson(execFileSync("npm", ["pack", "--silent", "--json", "--ignore-scripts", "--pack-destination", workspace], { cwd: root, encoding: "utf8" }));
      return { path: join(workspace, packed[0].filename), integrity: packed[0].integrity };
    },
  });
  const tarball = selectedArtifact.path;
  writeFileSync(join(playbackOnlyConsumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], {
    cwd: playbackOnlyConsumer,
    stdio: "inherit",
  });
  if (existsSync(join(playbackOnlyConsumer, "node_modules", "tsx")) || existsSync(join(playbackOnlyConsumer, "node_modules", "esbuild"))) {
    throw new Error("Default playback install unexpectedly included the optional template compiler");
  }
  execFileSync(process.execPath, ["--input-type=module", "--eval", 'await import("@vanillaskyai/video")'], {
    cwd: playbackOnlyConsumer,
    stdio: "inherit",
  });
  writeFileSync(join(serverConsumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball, "typescript@5.9.3"], { cwd: serverConsumer, stdio: "inherit" });
  writeFileSync(join(serverConsumer, "server.ts"), `
import { createVideoChatHandler, createServerTemplateRegistry } from "@vanillaskyai/video/server";
import type { VideoChatCapabilities, VideoChatHandlerOptions, VideoGenerationSummary, VideoProviderUsage, VideoWarning } from "@vanillaskyai/video/server";
import { createMockVideoPlanner, simulateVideoStream, videoFixtures } from "@vanillaskyai/video/test";
import type { MockVideoPlannerOptions, SimulatedVideoStreamOptions } from "@vanillaskyai/video/test";
// @ts-expect-error VideoPlanner is internal and must not be exported from the test entry.
import type { VideoPlanner } from "@vanillaskyai/video/test";
// @ts-expect-error VideoPlanPart is internal and must not be exported from the test entry.
import type { VideoPlanPart } from "@vanillaskyai/video/test";
// @ts-expect-error VideoEvent is internal and must not be exported from the test entry.
import type { VideoEvent } from "@vanillaskyai/video/test";
// @ts-expect-error VideoGenerationContext is internal and must not be exported from the test entry.
import type { VideoGenerationContext } from "@vanillaskyai/video/test";
// @ts-expect-error VideoState is internal to the test entry and must not be exported.
import type { VideoState } from "@vanillaskyai/video/test";
declare const chatOptions: VideoChatHandlerOptions;
const generationBudget: number | undefined = chatOptions.maxGeneratedVideos;
const previewOptions: VideoChatHandlerOptions = { ...chatOptions, generateVideoTimeoutMs: 120000 };
void previewOptions;
const noGeneratedAllowanceOptions: VideoChatHandlerOptions = { ...chatOptions, maxGeneratedVideos: 0 };
// @ts-expect-error The application budget is numeric, never a browser-supplied string.
const invalidBudget: VideoChatHandlerOptions = { ...chatOptions, maxGeneratedVideos: "5" };
void [generationBudget, noGeneratedAllowanceOptions, invalidBudget];
const stockSearch: NonNullable<VideoChatHandlerOptions["searchMedia"]> = (_query, { fallbackQuery }) => {
  const broaderSubject: string | undefined = fallbackQuery;
  void broaderSubject;
  return null;
};
void stockSearch;
declare const chatCapabilities: VideoChatCapabilities;
declare const summary: VideoGenerationSummary;
declare const usage: VideoProviderUsage;
declare const warning: VideoWarning;
declare const mockOptions: MockVideoPlannerOptions;
declare const simulationOptions: SimulatedVideoStreamOptions;
const mock = createMockVideoPlanner(mockOptions);
const simulation = simulateVideoStream(videoFixtures.portrait.parts, simulationOptions);
void [createVideoChatHandler, createServerTemplateRegistry, chatCapabilities, chatOptions, summary, usage, warning, mock, simulation];
`);
  writeFileSync(join(serverConsumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: false, types: [] }, include: ["server.ts"] }));
  execFileSync(process.execPath, [join(serverConsumer, "node_modules", "typescript", "bin", "tsc")], { cwd: serverConsumer, stdio: "inherit" });
  if (existsSync(join(serverConsumer, "node_modules", "react")) || existsSync(join(serverConsumer, "node_modules", "@types", "react"))) throw new Error("Test kit packed consumer unexpectedly installed React");
  const testDeclaration = readFileSync(join(serverConsumer, "node_modules", "@vanillaskyai", "video", "dist", "test.d.ts"), "utf8");
  for (const privateType of ["VideoPlanner", "VideoPlanPart", "VideoEvent", "VideoGenerationContext", "VideoState"]) {
    if (new RegExp(`\\b${privateType}\\b`).test(testDeclaration)) throw new Error(`Packed test declaration leaked ${privateType}`);
  }
  if (/from ["']\.\/(?:protocol|server|visual-system|test)\//.test(testDeclaration)) {
    throw new Error("Packed test declaration leaked an internal module path");
  }
  writeFileSync(join(serverConsumer, "budget.mjs"), `
import { createVideoChatHandler } from "@vanillaskyai/video/server";
let generated = 0;
let searched = 0;
let missStock = false;
const handler = createVideoChatHandler({
  authorize: "none", heartbeatMs: false, maxGeneratedVideos: 0,
  generateText: async () => "unused",
  generateVideo: async () => { generated++; throw new Error("must not spend"); },
  searchMedia: async () => { searched++; return missStock ? null : { type: "video", url: "https://media.example/stock.mp4" }; },
  streamText: async function* () {
    yield ${JSON.stringify(chatPlan("Watch the ocean", ["The waves move across the ocean toward the shore."], "ocean waves"))};
  },
});
const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "Ocean", mode: "cinematic", opening: "Watch the ocean" }) }));
const parseEvents = (body) => body.split("\\n").filter(line => line.startsWith("data: ") && line !== "data: [DONE]").map(line => JSON.parse(line.slice(6)));
const events = parseEvents(await response.text());
const scenes = events.filter(event => event.type === "scene.add").map(event => event.data.scene);
if (generated !== 0 || searched !== 0 || events.at(-1)?.type !== "response.complete"
  || scenes.length !== 1 || scenes[0].templateId !== "chapterTitle" || scenes[0].variables.title !== "ocean waves conclusion"
  || scenes[0].narration !== "The waves move across the ocean toward the shore.") throw new Error("Packed AI allowance recovery did not preserve its authored chapter without stock calls");
const stockResponse = await handler(new Request("https://app.example/api?action=response", {method: "POST", body: JSON.stringify({prompt: "Ocean", mode: "pexels"})}));
const stockEvents = parseEvents(await stockResponse.text());
const stockScenes = stockEvents.filter(event => event.type === "scene.add").map(event => event.data.scene);
if (generated !== 0 || searched !== 1 || stockEvents.at(-1)?.type !== "response.complete"
  || stockScenes.length !== 1 || stockScenes[0].templateId !== "cinemaMedia" || stockScenes[0].variables.mediaUrl !== "https://media.example/stock.mp4"
  || stockScenes[0].variables.fallbackText !== "ocean waves conclusion" || stockScenes[0].narration !== "The waves move across the ocean toward the shore.") throw new Error("Packed Pexels mode did not select stock independently of AI allowance");
missStock = true;
const missedStock = parseEvents(await (await handler(new Request("https://app.example/api?action=response", {method: "POST", body: JSON.stringify({prompt: "Ocean", mode: "pexels"})}))).text());
const missedScenes = missedStock.filter(event => event.type === "scene.add").map(event => event.data.scene);
if (generated !== 0 || searched !== 2 || missedStock.at(-1)?.type !== "response.complete"
  || missedScenes.length !== 1 || missedScenes[0].templateId !== "chapterTitle" || missedScenes[0].variables.title !== "ocean waves conclusion"
  || missedScenes[0].narration !== "The waves move across the ocean toward the shore.") throw new Error("Packed Pexels miss lost its authored chapter or invoked generation");
missStock = false;
const beforeWelcome = searched;
const welcome = await (await handler(new Request("https://app.example/api?action=welcome"))).json();
if (welcome.hero.url !== "https://videos.pexels.com/video-files/11335959/11335959-hd_1920_1080_30fps.mp4" || welcome.hero.type !== "video") throw new Error("Packed default cloud welcome drifted");
// Welcome still resolves four suggestion cards, but not its curated hero.
if (searched - beforeWelcome !== 4 || generated !== 0) throw new Error("Packed welcome changed response provider accounting");
`);
  execFileSync(process.execPath, [join(serverConsumer, "budget.mjs")], { cwd: serverConsumer, stdio: "inherit" });
  writeFileSync(join(serverConsumer, "root.mjs"), `
import { VideoValidationError, getVideoDuration, parseVideo } from "@vanillaskyai/video";
import * as root from "@vanillaskyai/video";
if (Object.keys(root).join() !== "VideoValidationError,getSceneDuration,getSceneDurationBounds,getSpokenDuration,getVideoDuration,parseVideo") throw new Error("Unexpected React-free root API");
const stored = {
  schemaVersion: "0.2",
  scenes: [{ id: "stored", templateId: "mobileMessage", variables: { message: "Stored" }, timing: { fixedDuration: 4 } }],
  style: {},
};
const parsed = parseVideo(JSON.parse(JSON.stringify(stored)));
if (getVideoDuration(parsed) !== 4 || !Object.isFrozen(parsed.scenes)) throw new Error("React-free root persistence contract failed");
if ("resolveVideoBrand" in root) throw new Error("Removed brand resolver remains exported");
try {
  parseVideo(JSON.parse(process.env.VANILLASKY_PERSISTED_VIDEO_FIXTURE));
  throw new Error("Old persisted schema was accepted");
} catch (error) {
  if (!(error instanceof VideoValidationError) || error.code !== "unsupported_video_version") throw error;
}
try {
  parseVideo({ ...stored, style: { brand: {} } });
  throw new Error("Old brand payload was accepted");
} catch (error) {
  if (!(error instanceof VideoValidationError) || error.code !== "invalid_video") throw error;
}
try {
  parseVideo({ ...stored, schemaVersion: "9.0" });
  throw new Error("Future persisted schema was accepted");
} catch (error) {
  if (!(error instanceof VideoValidationError) || error.code !== "unsupported_video_version") throw error;
}
`);
  execFileSync(process.execPath, [join(serverConsumer, "root.mjs")], {
    cwd: serverConsumer,
    stdio: "inherit",
    env: { ...process.env, VANILLASKY_PERSISTED_VIDEO_FIXTURE: persistedVideoFixture },
  });
  writeFileSync(join(serverConsumer, "server.mjs"), `
import { createVideoChatHandler } from "@vanillaskyai/video/server";
let completed;
const handler = createVideoChatHandler({
  generateText: async () => "A useful answer",
  authorize: "none",
  heartbeatMs: false,
  onComplete: (summary) => { completed = summary; },
  streamText: () => ({
    textStream: (async function* () {
      yield ${JSON.stringify(chatPlan("Start here", ["Server-only narration remains available without media."], "server racks"))};
    })(),
    finishReason: "stop",
    usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
  }),
});
const response = await handler(new Request("https://app.example/api/video-chat?action=response", {
  method: "POST",
  body: JSON.stringify({ prompt: "Grounded", opening: "Start here" }),
}));
const body = await response.text();
if (!body.includes('"type":"response.complete"') || completed?.usage?.totalTokens !== 6) throw new Error("Server-only packed lifecycle failed");
if (body.includes("inputTokens") || body.includes("totalTokens")) throw new Error("Server-only packed lifecycle leaked usage into SSE");
const complete = body
  .split("\\n")
  .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
  .map((line) => JSON.parse(line.slice(6)))
  .find(({ type }) => type === "response.complete");
if (!/^fnv1a32:[0-9a-f]{8}$/.test(complete?.data.checksum)) throw new Error("Packed response omitted its checksum");
if (complete.data.snapshot.schemaVersion !== "0.2") throw new Error("Packed terminal snapshot lost its schema version");
if (complete.data.snapshot.scenes[0]?.narration !== "Server-only narration remains available without media.") throw new Error("Packed terminal snapshot lost its completed scene");

const videoChat = createVideoChatHandler({
  authorize: "none",
  heartbeatMs: false,
  streamText: async function* () {
    yield ${JSON.stringify(chatPlan("A tiny story begins", ["A small robot found a forgotten flower.", "It watered the flower, then waited for spring."], "robot flower"))};
  },
  generateText: async () => "Provider-neutral text",
});
const chatCapabilities = await videoChat(new Request("https://app.example/api/video-chat?action=capabilities"));
if ((await chatCapabilities.json()).modes.join() !== "cinematic") throw new Error("Packed video chat capabilities drifted");
const chatResponse = await videoChat(new Request("https://app.example/api/video-chat?action=response", {
  method: "POST",
  body: JSON.stringify({ prompt: "Tell me a tiny story", mode: "cinematic" }),
}));
if (!(await chatResponse.text()).includes('"type":"response.complete"')) throw new Error("Packed video chat response did not complete");
`);
  execFileSync(process.execPath, [join(serverConsumer, "server.mjs")], { cwd: serverConsumer, stdio: "inherit" });

  writeFileSync(join(serverConsumer, "test-kit.mjs"), `
import { createVideoChatHandler, createServerTemplateRegistry } from "@vanillaskyai/video/server";
import { createMockVideoPlanner, simulateVideoStream, videoFixtures } from "@vanillaskyai/video/test";

if (Object.keys(await import("@vanillaskyai/video/test")).sort().join() !== "createMockVideoPlanner,simulateVideoStream,videoFixtures") {
  throw new Error("Unexpected packed test API");
}
if (!Object.isFrozen(videoFixtures.portrait.input) || !Object.isFrozen(videoFixtures.scenarios.success)) {
  throw new Error("Packed test fixtures are mutable");
}

const collect = async (source) => {
  const events = [];
  for await (const event of source) events.push(event);
  return events;
};
const parseSse = (body) => body.split("\\n")
  .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
  .map((line) => JSON.parse(line.slice(6)));

const handler = createVideoChatHandler({ generateText: async () => "A useful answer", authorize: "none", heartbeatMs: false, templates: createServerTemplateRegistry({ templates: [] }), streamText: createMockVideoPlanner() });
const response = await handler(new Request("https://app.example/api/video-chat?action=response", {
  method: "POST",
  body: JSON.stringify({ prompt: videoFixtures.portrait.input.input, orientation: "portrait", opening: "Start here" }),
}));
const routeEvents = parseSse(await response.text());
if (routeEvents.at(-1)?.type !== "response.complete" || !routeEvents.at(-1)?.data?.snapshot?.scenes?.length) throw new Error("Packed mock did not complete through SSE");

const success = await collect(simulateVideoStream(videoFixtures.scenarios.success));
const delayed = await collect(simulateVideoStream(videoFixtures.scenarios.delayed));
const truncated = await collect(simulateVideoStream(videoFixtures.scenarios.truncated));
const invalidScene = await collect(simulateVideoStream(videoFixtures.scenarios.invalidScene));
const providerFailure = await collect(simulateVideoStream(videoFixtures.scenarios.providerFailure, { input: { ...videoFixtures.portrait.input, opening: false } }));
const contentFilter = await collect(simulateVideoStream(videoFixtures.scenarios.contentFilter));
if (success[0]?.eventId !== "test-run:0" || success.at(-1)?.type !== "response.complete") throw new Error("Packed success scenario is not deterministic");
if (delayed.at(-1)?.type !== "response.complete") throw new Error("Packed delayed scenario failed");
if (truncated.at(-1)?.data?.finishReason !== "length" || truncated.at(-1)?.data?.snapshot?.scenes?.length !== 2) throw new Error("Packed truncation lost its playable result");
if (!invalidScene.some((event) => event.type === "response.warning" && event.data.warning.recoverable) || invalidScene.at(-1)?.type !== "response.complete") throw new Error("Packed invalid scene did not recover");
if (providerFailure.at(-1)?.type !== "response.error" || JSON.stringify(providerFailure).includes("fixture-private-value")) throw new Error("Packed provider failure was not redacted");
if (contentFilter.at(-1)?.data?.finishReason !== "content-filter" || contentFilter.at(-1)?.data?.snapshot?.scenes?.length !== 2) throw new Error("Packed content filter lost its playable result");

const abortController = new AbortController();
const abort = [];
for await (const event of simulateVideoStream(videoFixtures.scenarios.abort, { signal: abortController.signal })) {
  abort.push(event);
  if (event.type === "scene.add" && event.data.scene.id === "abort-partial") {
    abortController.abort("packed consumer cancelled");
  }
}
if (abort.at(-1)?.type !== "response.abort" || abort.at(-1)?.data?.reason !== "packed consumer cancelled") throw new Error("Packed abort scenario failed");

const timeout = await collect(simulateVideoStream(videoFixtures.scenarios.timeout, { timeoutMs: 1 }));
if (timeout.at(-1)?.type !== "response.abort" || timeout.at(-1)?.data?.reason !== "Request timed out") throw new Error("Packed timeout scenario failed");

const failureHandler = createVideoChatHandler({
  generateText: async () => "A useful answer",
  authorize: "none",
  heartbeatMs: false,
  streamText: createMockVideoPlanner({ scenario: "providerFailure" }),
});
const failureResponse = await failureHandler(new Request("https://app.example/api/video-chat?action=response", {
  method: "POST",
  body: JSON.stringify({ prompt: "A useful answer", opening: "Start here" }),
}));
const failureBody = await failureResponse.text();
if (!failureBody.includes('"type":"response.error"') || failureBody.includes("fixture-private-value")) throw new Error("Packed empty response failure was not redacted");
`);
  execFileSync(process.execPath, [join(serverConsumer, "test-kit.mjs")], { cwd: serverConsumer, stdio: "inherit" });

  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball, "react@18.3.1", "react-dom@18.3.1", "@types/react@18.3.28", "@types/react-dom@18.3.7", "typescript@5.9.3", "tsx@4.23.12", "vite@8.2.2"], { cwd: consumer, stdio: "inherit" });

  const packageRoot = join(consumer, "node_modules", "@vanillaskyai", "video");
  await verifyPublicApiSurface({
    packageRoot,
    manifestPath: join(root, "tests", "fixtures", "public-api-surface.json"),
    signaturePath: join(root, "tests", "fixtures", "public-api-signatures.json"),
  });
  const packedCli = join(consumer, "node_modules", "@vanillaskyai", "video", "bin", "vanillasky.js");
  const persistenceGuide = readFileSync(join(packageRoot, "docs", "persistence.md"), "utf8");
  const persistenceExample = persistenceGuide.match(
    /<!-- verify:persistence-example:start -->\s*```tsx\r?\n([\s\S]*?)\r?\n```\s*<!-- verify:persistence-example:end -->/,
  )?.[1];
  if (!persistenceExample) {
    throw new Error("Packed persistence guide omitted its compilable example");
  }
  writeFileSync(join(consumer, "persistence-example.tsx"), persistenceExample);
  writeFileSync(join(consumer, "persistence-example-tsconfig.json"), JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      skipLibCheck: false,
      isolatedModules: true,
    },
    include: ["persistence-example.tsx"],
  }));
  execFileSync(process.execPath, [
    join(consumer, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    "persistence-example-tsconfig.json",
  ], { cwd: consumer, stdio: "inherit" });
  const customTemplateGuide = readFileSync(join(packageRoot, "docs", "custom-templates.md"), "utf8");
  const customTemplatePreview = customTemplateGuide.match(
    /<!-- verify:custom-template-preview:start -->\s*```tsx\r?\n([\s\S]*?)\r?\n```\s*<!-- verify:custom-template-preview:end -->/,
  )?.[1];
  if (!customTemplatePreview) {
    throw new Error("Packed custom-template guide omitted its compilable preview example");
  }
  const transitionSemanticValue = customTemplateGuide.match(
    /<!-- verify:transition-semantic-value:start -->\s*```tsx\r?\n([\s\S]*?)\r?\n```\s*<!-- verify:transition-semantic-value:end -->/,
  )?.[1];
  if (!transitionSemanticValue) {
    throw new Error("Packed custom-template guide omitted its compilable transition semantic example");
  }
  mkdirSync(join(consumer, "src"), { recursive: true });
  mkdirSync(join(consumer, "vanillasky"), { recursive: true });
  writeFileSync(join(consumer, "src", "custom-template-preview.tsx"), customTemplatePreview);
  writeFileSync(join(consumer, "src", "transition-semantic-value.tsx"), transitionSemanticValue);
  writeFileSync(join(consumer, "vanillasky", "index.ts"), `
import { createTemplateRegistry } from "@vanillaskyai/video/templates";
export const templates = createTemplateRegistry({ definitions: [] });
`);
  writeFileSync(join(consumer, "custom-template-preview-tsconfig.json"), JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      skipLibCheck: false,
      isolatedModules: true,
    },
    include: ["src/custom-template-preview.tsx", "src/transition-semantic-value.tsx", "vanillasky/index.ts"],
  }));
  execFileSync(process.execPath, [
    join(consumer, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    "custom-template-preview-tsconfig.json",
  ], { cwd: consumer, stdio: "inherit" });
  rmSync(join(consumer, "vanillasky"), { recursive: true, force: true });
  execFileSync(process.execPath, [packedCli, "templates", "add", "keyFigure", "--dry-run"], { cwd: consumer, stdio: "ignore" });
  execFileSync(process.execPath, [packedCli, "templates", "add", "keyFigure", "--diff"], { cwd: consumer, stdio: "ignore" });
  if (existsSync(join(consumer, "vanillasky"))) {
    throw new Error("Packed add preview commands changed the consumer");
  }
  execFileSync(process.execPath, [packedCli, "templates", "add", "keyFigure"], { cwd: consumer, stdio: "inherit" });
  const copiedCheckOutput = execFileSync(process.execPath, [packedCli, "templates", "check"], { cwd: consumer, encoding: "utf8" });
  if (!copiedCheckOutput.includes("12 deterministic renders")) {
    throw new Error(`Packed copied-template check failed:\n${copiedCheckOutput}`);
  }
  rmSync(join(consumer, "vanillasky"), { recursive: true, force: true });
  execFileSync(process.execPath, [packedCli, "templates", "add", "--all"], { cwd: consumer, stdio: "inherit" });
  const catalogCheckOutput = execFileSync(process.execPath, [packedCli, "templates", "check"], { cwd: consumer, encoding: "utf8" });
  const catalogSummary = "Checked 7 templates, 7 examples, and 84 deterministic renders.";
  if (!catalogCheckOutput.includes(catalogSummary)) throw new Error(`Packed built-in catalog check failed:\n${catalogCheckOutput}`);
  rmSync(join(consumer, "vanillasky"), { recursive: true, force: true });

  const createOutput = execFileSync(process.execPath, [packedCli, "templates", "create", "customer-health"], { cwd: consumer, encoding: "utf8" });
  for (const expected of [
    "Created template: vanillasky/templates/customer-health.tsx",
    "Synced 1 template to vanillasky/index.ts and vanillasky/server.ts.",
    "Source: vanillasky/templates/customer-health.tsx",
    "vanillasky templates check",
  ]) {
    if (!createOutput.includes(expected)) throw new Error(`Packed create output omitted ${JSON.stringify(expected)}:\n${createOutput}`);
  }
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, noUnusedLocals: true, noUnusedParameters: true, noEmit: true, target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", skipLibCheck: false, isolatedModules: true },
    include: ["vanillasky/**/*.ts", "vanillasky/**/*.tsx"],
  }));
  execFileSync(process.execPath, [join(consumer, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: consumer, stdio: "inherit" });
  const checkOutput = execFileSync(process.execPath, [packedCli, "templates", "check"], { cwd: consumer, encoding: "utf8" });
  if (!checkOutput.includes("12 deterministic renders")) throw new Error(`Packed template check failed:\n${checkOutput}`);
  execFileSync(process.execPath, [packedCli, "templates", "list"], { cwd: consumer, stdio: "ignore" });
  execFileSync(process.execPath, [packedCli, "templates", "describe", "customer-health"], { cwd: consumer, stdio: "ignore" });
  const effectiveCatalog = JSON.parse(execFileSync(process.execPath, [packedCli, "templates", "list", "--json"], { cwd: consumer, encoding: "utf8" }));
  const customerCatalogEntry = effectiveCatalog.find(({ id }) => id === "customer-health");
  if (customerCatalogEntry?.origin !== "project" || customerCatalogEntry.status !== "current") {
    throw new Error(`Packed effective catalog lost current customer source:\n${JSON.stringify(customerCatalogEntry, null, 2)}`);
  }
  const builtinCatalog = JSON.parse(execFileSync(process.execPath, [packedCli, "templates", "list", "--builtin", "--json"], { cwd: consumer, encoding: "utf8" }));
  if (builtinCatalog.some(({ id }) => id === "customer-health")) throw new Error("Packed built-in catalog included project source");
  const customerDescription = JSON.parse(execFileSync(process.execPath, [packedCli, "templates", "describe", "customer-health", "--json"], { cwd: consumer, encoding: "utf8" }));
  if (customerDescription.origin !== "project" || customerDescription.generated?.current !== true) {
    throw new Error(`Packed describe did not report current project source:\n${JSON.stringify(customerDescription, null, 2)}`);
  }

  rmSync(join(consumer, "vanillasky"), { recursive: true, force: true });
  const referenceRoot = join(packageRoot, "examples", "custom-template");
  const customerTemplates = join(consumer, "vanillasky", "templates");
  mkdirSync(customerTemplates, { recursive: true });
  for (const file of ["minimal-text.tsx", "structured-data.tsx"]) {
    cpSync(join(referenceRoot, file), join(customerTemplates, file));
  }
  // Exercise the source-owned copy of SceneBackground against VideoPlayer
  // from the tarball. This is a distinct module boundary from packaged
  // built-ins and must share the Mobile Safari backdrop contract safely.
  execFileSync(process.execPath, [packedCli, "templates", "add", "cinemaMedia"], { cwd: consumer, stdio: "inherit" });
  const previewImageUrl = JSON.stringify("data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#2167E3"/></svg>'));
  execFileSync(process.execPath, [packedCli, "templates", "sync"], { cwd: consumer, stdio: "inherit" });
  const referenceCheckOutput = execFileSync(process.execPath, [packedCli, "templates", "check"], { cwd: consumer, encoding: "utf8" });
  if (!referenceCheckOutput.includes("36 deterministic renders")) {
    throw new Error(`Packed custom reference check failed:\n${referenceCheckOutput}`);
  }
  execFileSync(process.execPath, [join(consumer, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: consumer, stdio: "inherit" });

  writeFileSync(join(consumer, "api.mjs"), `
import * as root from "@vanillaskyai/video";
import * as server from "@vanillaskyai/video/server";
import * as react from "@vanillaskyai/video/react";
import * as templates from "@vanillaskyai/video/templates";
import { builtinTemplates } from "@vanillaskyai/video/templates/catalog";
if (Object.keys(root).join() !== "VideoValidationError,getSceneDuration,getSceneDurationBounds,getSpokenDuration,getVideoDuration,parseVideo") throw new Error("Unexpected root API");
const resolvedStyle = {};
const rootVideo = root.parseVideo({ schemaVersion: "0.2", scenes: [{ id: "one", templateId: "mobileMessage", variables: {}, timing: { fixedDuration: 4 } }], style: resolvedStyle });
if (root.getVideoDuration(rootVideo) !== 4 || !Object.isFrozen(rootVideo)) {
  throw new Error("Packed duration helper returned an unexpected timeline");
}
if (Object.keys(server).sort().join() !== "createServerTemplateRegistry,createVideoChatHandler") throw new Error("Unexpected server API");
if (Object.keys(react).sort().join() !== "VideoChat,VideoError,VideoPlayer,createVideoChatVoice,useVideoChat") throw new Error("Unexpected React API");
if (Object.keys(templates).sort().join() !== "createTemplateRegistry,defineTemplate") throw new Error("Unexpected template API");
if (builtinTemplates.length !== 7) throw new Error("Unexpected built-in template manifest");
try {
  templates.defineTemplate({ id: "removedDuration", useWhen: "Never", schema: { type: "object", properties: {} }, duration: 2, component: () => null });
  throw new Error("Packed template API accepted the removed duration alias");
} catch (error) {
  if (error.message !== "Template duration is not supported; use preferredDuration") throw error;
}
let lifecycleSummary;
const openingStock = server.createVideoChatHandler({
  authorize: "none", generateText: async () => "", streamText: async function* () {},
  searchMedia: (_query, context) => {
    if (context.fallbackQuery !== "medieval castle") throw new Error("Missing packed opening fallback query");
    return { type: "video", url: "https://media.example/castle.mp4" };
  },
});
const openingStockResponse = await openingStock(new Request("https://app.example/api/video-chat?action=opening-media", {
  method: "POST", body: JSON.stringify({ keyword: "Minecraft castle", fallbackKeyword: "medieval castle" }),
}));
if ((await openingStockResponse.json()).media?.url !== "https://media.example/castle.mp4") throw new Error("Packed opening fallback contract failed");

const pacingHandler = server.createVideoChatHandler({
  generateText: async () => "A useful answer",
  authorize: "none",
  heartbeatMs: false,
  includeRawProviderData: true,
  onComplete: (summary) => { lifecycleSummary = summary; },
  streamText: () => ({
    textStream: (async function* () {
      yield ${JSON.stringify(chatPlan("Start here", ["Revenue reached forty-two million this year.", "Read release notes with your team."], "team reviewing report"))};
    })(),
    finishReason: Promise.resolve("stop"),
    usage: Promise.resolve({ inputTokens: 20, outputTokens: 10, totalTokens: 30, inputTokenDetails: { cacheReadTokens: 5 }, outputTokenDetails: { reasoningTokens: 2 } }),
    providerMetadata: Promise.resolve({ openai: { responseId: "packed-private-response" } }),
    steps: Promise.resolve([{ model: { modelId: "packed-requested-model" } }]),
    response: Promise.resolve({ modelId: "packed-resolved-model" }),
  }),
});
const pacingResponse = await pacingHandler(new Request("https://app.example/api/video-chat?action=response", {
  method: "POST",
  body: JSON.stringify({
    prompt: "Revenue reached 42 million. Acme: Read every new OpenAI release note with your team at openai.com/releases.", opening: "Start here",
  }),
}));
const pacingEvents = (await pacingResponse.text())
  .split("\\n")
  .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
  .map((line) => JSON.parse(line.slice(6)));
if (lifecycleSummary?.usage?.totalTokens !== 30 || lifecycleSummary?.usage?.cachedInputTokens !== 5 || lifecycleSummary?.usage?.reasoningTokens !== 2) throw new Error("Packed handler did not normalize usage");
if (lifecycleSummary?.requestedModelId !== "packed-requested-model" || lifecycleSummary?.resolvedModelId !== "packed-resolved-model") throw new Error("Packed handler lost model lifecycle metadata");
if (lifecycleSummary?.acceptedSceneCount !== 2 || lifecycleSummary?.providerMetadata?.openai?.responseId !== "packed-private-response") throw new Error("Packed handler lost the server-only completion summary");
if (JSON.stringify(pacingEvents).match(/packed-private-response|packed-requested-model|packed-resolved-model|totalTokens/)) throw new Error("Packed handler leaked server lifecycle metadata into SSE");
const startEvent = pacingEvents.find(({ type }) => type === "response.start");
if ("brand" in startEvent.data.style) throw new Error("Packed handler retained removed brand state");
const pacedScenes = pacingEvents.filter(({ type }) => type === "scene.add").map(({ data }) => data.scene);
if (pacedScenes.length !== 2 || pacedScenes[1].narration !== "Read release notes with your team.") throw new Error("Packed chat lost its closer");
if (pacedScenes.some((scene) => root.getSceneDuration(scene) <= 0)) throw new Error("Packed chat emitted unreadable timing");
if (pacedScenes[1].timing.startTime !== pacedScenes[0].timing.endTime) throw new Error("Packed chat scene timing is not contiguous");

// Exercise the installed chat stack with local mocks only: no provider network
// requests, credentials, or generated-video credits are involved.
const privateCanary = "packed-private-provider-canary";
const completedClip = "https://media.example/completed.mp4";
const replacementClip = "https://media.example/replacement.mp4";
let generatedCalls = 0;
let stockCalls = 0;
const resilientChat = server.createVideoChatHandler({
  authorize: "none",
  heartbeatMs: false,
  generateText: async () => "Ocean currents move warmth around the world.",
  generateVideo: async () => {
    generatedCalls += 1;
    if (generatedCalls === 1) return { type: "video", url: completedClip };
    throw new DOMException(privateCanary, "TimeoutError");
  },
  searchMedia: async () => {
    stockCalls += 1;
    return { type: "video", url: replacementClip };
  },
  streamText: () => (async function* () {
    const parts = ${JSON.stringify(chatPlan("Ocean currents carry warmth around the world.", ["Warm water travels around the world.", "Currents connect our oceans."]))}.trim().split("\\n");
    yield parts[0] + "\\n";
    yield parts[1] + "\\n";
    yield '{"type":"shot", malformed}\\n';
  })(),
});
const resilientResponse = await resilientChat(new Request("https://app.example/api/video-chat?action=response", {
  method: "POST",
  body: JSON.stringify({ prompt: "Explain ocean currents", mode: "cinematic" }),
}));
if (!resilientResponse.ok) throw new Error("Packed resilient chat request failed");
const resilientBody = await resilientResponse.text();
const resilientEvents = resilientBody.split("\\n")
  .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
  .map((line) => JSON.parse(line.slice(6)));
if (generatedCalls !== 2 || stockCalls !== 0) throw new Error("Packed chat did not isolate the failed generated provider");
const openingIndex = resilientEvents.findIndex(({ type }) => type === "data.video-chat-opening");
const firstSceneIndex = resilientEvents.findIndex(({ type }) => type === "scene.add");
if (openingIndex < 0 || openingIndex >= firstSceneIndex
  || resilientEvents[openingIndex].data.line !== "Ocean currents carry warmth around the world.") {
  throw new Error("Packed chat did not preserve its opening before recovered scenes");
}
const resilientScenes = resilientEvents.filter(({ type }) => type === "scene.add").map(({ data }) => data.scene);
if (JSON.stringify(resilientScenes.map(({ templateId, narration, variables }) => [templateId, narration, variables.mediaUrl ?? variables.title])) !== JSON.stringify([
  ["cinemaMedia", "Warm water travels around the world.", completedClip], ["chapterTitle", "Currents connect our oceans.", "ocean currents conclusion"],
])) throw new Error("Packed chat lost completed or later scenes during recovery");
if (resilientEvents.some(({ type, data }) => type === "response.error" && data.terminal)
  || resilientEvents.at(-1)?.type !== "response.complete") throw new Error("Packed recovered chat ended fatally");
for (const scene of resilientScenes) {
  const preparation = resilientEvents.findIndex(event => event.type === "data.video-chat-preparation" && event.data.sceneId === scene.id && event.data.narration === scene.narration);
  const emitted = resilientEvents.findIndex(event => event.type === "scene.add" && event.data.scene.id === scene.id);
  if (preparation < 0 || preparation >= emitted) throw new Error("Packed speech preparation did not precede its resolved scene");
}
const recoveredSnapshot = root.parseVideo(resilientEvents.at(-1).data.snapshot);
if (recoveredSnapshot.scenes.length !== 2) throw new Error("Packed recovered snapshot is not replayable");
if (!resilientEvents.some(({ type, data }) => type === "response.warning" && data.warning.recoverable)) {
  throw new Error("Packed recovered chat omitted its non-fatal warning");
}
if (resilientBody.includes(privateCanary) || resilientBody.includes("TimeoutError")) {
  throw new Error("Packed recovered chat leaked private provider diagnostics");
}

// This provider genuinely never settles, rather than throwing a timeout itself.
// Verify the packaged deadline preserves the first scene and produces a safe
// replayable completion without waiting for application-owned cancellation.
let deadlineGeneratedCalls = 0;
let stalledGenerationSignal;
let deadlineStockCalls = 0;
const deadlineChat = server.createVideoChatHandler({
  authorize: "none",
  heartbeatMs: false,
  generateVideoTimeoutMs: 50, generatedClipDurationSec: 2,
  generateText: async () => "Ocean currents move warmth around the world.",
  generateVideo: async (_query, context) => {
    if (++deadlineGeneratedCalls === 1) return { type: "video", url: completedClip };
    stalledGenerationSignal = context.signal;
    return new Promise(() => {});
  },
  searchMedia: () => {deadlineStockCalls++; return {type: "video", url: replacementClip};},
  streamText: () => (async function* () {
    yield ${JSON.stringify(chatPlan("Ocean currents carry warmth.", ["Warm water moves through the ocean.", "Currents connect distant shores."]))};
  })(),
});
const deadlineStarted = performance.now();
let deadlineWatchdog;
let deadlineBody;
try {
  deadlineBody = await Promise.race([
    deadlineChat(new Request("https://app.example/api/video-chat?action=response", {
      method: "POST", body: JSON.stringify({ prompt: "Explain ocean currents", mode: "cinematic" }),
    })).then((response) => response.text()),
    new Promise((_resolve, reject) => {
      deadlineWatchdog = setTimeout(() => reject(new Error("Packed optional provider blocked completion beyond its deadline")), 8_000);
    }),
  ]);
} finally {
  clearTimeout(deadlineWatchdog);
}
if (performance.now() - deadlineStarted >= 8_000 || !stalledGenerationSignal?.aborted || deadlineStockCalls !== 0 || deadlineGeneratedCalls !== 2) {
  throw new Error("Packed chat did not cancel slow generated work without crossing media modes");
}
const deadlineEvents = deadlineBody.split("\\n")
  .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
  .map((line) => JSON.parse(line.slice(6)));
if (deadlineEvents.at(-1)?.type !== "response.complete"
  || deadlineEvents.some(({ type, data }) => type === "response.error" && data.terminal)) {
  throw new Error("Packed chat failed instead of recovering from a hanging provider");
}
const deadlineVideo = root.parseVideo(deadlineEvents.at(-1).data.snapshot);
if (deadlineVideo.scenes.length !== 2 || deadlineVideo.scenes[0].narration !== "Warm water moves through the ocean."
  || deadlineVideo.scenes[0].variables.mediaUrl !== completedClip
  || deadlineVideo.scenes[1].narration !== "Currents connect distant shores."
  || deadlineVideo.scenes[1].templateId !== "chapterTitle"
  || deadlineVideo.scenes[1].variables.title !== "ocean currents conclusion") {
  throw new Error("Packed provider deadline lost completed scenes or its authored chapter narration");
}
if (!deadlineEvents.some(({ type, data }) => type === "response.warning" && data.warning.recoverable)
  || /packed-private-provider-canary|TimeoutError|Optional work exceeded/.test(deadlineBody)) {
  throw new Error("Packed provider deadline omitted safe warnings or leaked diagnostics");
}
`);
  execFileSync(process.execPath, [join(consumer, "api.mjs")], { cwd: consumer, stdio: "inherit" });

  writeFileSync(join(consumer, "types.ts"), `
import { createElement } from "react";
import { VideoValidationError, parseVideo } from "@vanillaskyai/video";
import type { Video, VideoValidationErrorCode } from "@vanillaskyai/video";
// @ts-expect-error VideoState is internal and must not be exported from the root.
import type { VideoState } from "@vanillaskyai/video";
import { createVideoChatVoice, VideoChat, VideoError, VideoPlayer, useVideoChat } from "@vanillaskyai/video/react";
import type { UseVideoChatOptions, UseVideoChatResult, VideoChatPlaybackMetric, VideoChatProps, VideoChatTurn, VideoChatVoice } from "@vanillaskyai/video/react";
// @ts-expect-error VideoPlayerBinding is internal and must not be exported from React.
import type { VideoPlayerBinding } from "@vanillaskyai/video/react";
import type { VideoChatCapabilities, VideoChatHandlerOptions, VideoGenerationSummary, VideoProviderUsage, VideoWarning } from "@vanillaskyai/video/server";
import type { BuiltinTemplateId, BuiltinTemplateMetadata } from "@vanillaskyai/video/templates/catalog";
import type { SceneTemplate, SceneTemplateMetadata, SceneTemplateProps, TemplateFamily, TemplateRegistry, TemplateTimingMetadata, TemplateTransitionTiming } from "@vanillaskyai/video/templates";
// @ts-expect-error Undocumented Template alias is not part of 0.1.
import type { Template } from "@vanillaskyai/video/templates";
// @ts-expect-error Undocumented TemplateMetadata alias is not part of 0.1.
import type { TemplateMetadata } from "@vanillaskyai/video/templates";
// @ts-expect-error Undocumented TemplateProps alias is not part of 0.1.
import type { TemplateProps } from "@vanillaskyai/video/templates";
// @ts-expect-error AuthoringTemplate is inferred and internal.
import type { AuthoringTemplate } from "@vanillaskyai/video/templates";
// @ts-expect-error TemplateFamily has one canonical home under templates.
import type { TemplateFamily as CatalogTemplateFamily } from "@vanillaskyai/video/templates/catalog";
// @ts-expect-error TemplateTimingMetadata has one canonical home under templates.
import type { TemplateTimingMetadata as CatalogTemplateTimingMetadata } from "@vanillaskyai/video/templates/catalog";
// @ts-expect-error Undocumented manifest-entry name is not part of 0.1.
import type { BuiltinTemplateManifestEntry } from "@vanillaskyai/video/templates/catalog";

// @ts-expect-error Brand input was removed from the cinematic contract.
import type { VideoBrandInput } from "@vanillaskyai/video";
// @ts-expect-error Configurable resolved brand was removed.
import type { VideoBrand } from "@vanillaskyai/video";
// @ts-expect-error Public background presets were removed.
import type { VideoBackground } from "@vanillaskyai/video";
const validationCode: VideoValidationErrorCode = "unsupported_video_version";
const parsedVideo = parseVideo({} as unknown);
declare const video: Video;
declare const validationError: VideoValidationError;
declare const error: VideoError;
declare const chatHook: UseVideoChatResult;
declare const chatTurn: VideoChatTurn;
const chatWarnings: readonly string[] = chatHook.warnings;
const turnWarnings: readonly string[] | undefined = chatTurn.warnings;
declare const chatVoice: VideoChatVoice;
declare const chatHandlerOptions: VideoChatHandlerOptions;
declare const chatCapabilities: VideoChatCapabilities;
declare const summary: VideoGenerationSummary;
declare const usage: VideoProviderUsage;
declare const warning: VideoWarning;
const savedPlayer = createElement(VideoPlayer, {
  video,
  autoPlay: false,
  onPlaybackEnd: (completed) => { void completed.schemaVersion; },
  onFramePresented: () => undefined,
  onStallChange: (stalled) => { const waiting: boolean = stalled; void waiting; },
});
const createdChatVoice = createVideoChatVoice({ fetcher: fetch, onFallback: () => undefined });
type Assert<T extends true> = T;
type Same<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type FrameFields = Assert<Same<keyof Extract<VideoChatPlaybackMetric, { type: "first-frame" }>, "type" | "turnId" | "mode" | "elapsedMs">>;
type SpeechFields = Assert<Same<keyof Extract<VideoChatPlaybackMetric, { type: "first-speech" }>, "type" | "turnId" | "mode" | "elapsedMs" | "source">>;
type StallFields = Assert<Same<keyof Extract<VideoChatPlaybackMetric, { type: "stall" }>, "type" | "turnId" | "mode" | "elapsedMs" | "durationMs" | "reason">>;
const metricTypeChecks: [FrameFields, SpeechFields, StallFields] = [true, true, true];
const performanceOptions: UseVideoChatOptions = {
  onPlaybackMetric: (metric) => {
    const elapsed: number = metric.elapsedMs;
    if (metric.type === "first-speech") {
      const source: "browser" | "generated" | "custom" = metric.source;
      return [elapsed, source];
    }
    if (metric.type === "stall") {
      const duration: number = metric.durationMs;
      const reason: "scene-generation" = metric.reason;
      return [elapsed, duration, reason];
    }
    // @ts-expect-error Frame observations contain no provider diagnostics.
    metric.source;
    return elapsed;
  },
};
const metric: VideoChatPlaybackMetric = { type: "first-frame", turnId: "turn", mode: "cinematic", elapsedMs: 10 };
// @ts-expect-error Performance events contain no prompt text.
const promptMetric: VideoChatPlaybackMetric = { type: "first-frame", turnId: "turn", mode: "cinematic", elapsedMs: 10, prompt: "private" };
// @ts-expect-error Speech source is a bounded category, never a provider name.
const providerMetric: VideoChatPlaybackMetric = { type: "first-speech", turnId: "turn", mode: "cinematic", elapsedMs: 10, source: "provider" };
void createdChatVoice.speak("Spoken onset", { signal: new AbortController().signal, onStart: (source) => {
  const kind: "browser" | "generated" | undefined = source;
  void kind;
} });
void [metricTypeChecks, performanceOptions, metric, promptMetric, providerMetric];

const videoChatProps: VideoChatProps = { options: { voice: chatVoice }, className: "customer-shell", showRecoveryNotice: true };
const packedVideoChat = createElement(VideoChat, videoChatProps);
const PackedChatTypeProbe = () => {
  const chat = useVideoChat({ voice: chatVoice, ...performanceOptions });
  return createElement("output", null, chat.status, chatTurn.completed ? "complete" : "pending");
};
const builtinId: BuiltinTemplateId = "keyFigure";
const family: TemplateFamily = "Data & metrics";
declare const builtinMetadata: BuiltinTemplateMetadata;
declare const sceneTemplate: SceneTemplate;
declare const sceneMetadata: SceneTemplateMetadata;
declare const sceneProps: SceneTemplateProps;
declare const templateRegistry: TemplateRegistry;
declare const timingMetadata: TemplateTimingMetadata;
declare const transitionTiming: TemplateTransitionTiming;
sceneProps.motionProgress;
// @ts-expect-error useVideo is no longer public.
import { useVideo } from "@vanillaskyai/video/react";
// @ts-expect-error useNarration is no longer public.
import { useNarration } from "@vanillaskyai/video/react";
// @ts-expect-error UseVideoOptions is no longer public.
import type { UseVideoOptions } from "@vanillaskyai/video/react";
// @ts-expect-error UseVideoResult is no longer public.
import type { UseVideoResult } from "@vanillaskyai/video/react";
// @ts-expect-error Narration is no longer public.
import type { Narration } from "@vanillaskyai/video/react";
// @ts-expect-error NarrationOptions is no longer public.
import type { NarrationOptions } from "@vanillaskyai/video/react";
// @ts-expect-error NarrationVoice is no longer public.
import type { NarrationVoice } from "@vanillaskyai/video/react";
// @ts-expect-error Timeline construction is internal to chat.
import { createSceneTimeline } from "@vanillaskyai/video";
// @ts-expect-error VideoInput is no longer public.
import type { VideoInput } from "@vanillaskyai/video";
// @ts-expect-error VideoKnowledgeMode is no longer public.
import type { VideoKnowledgeMode } from "@vanillaskyai/video";
// @ts-expect-error VideoSuppliedMedia is no longer public.
import type { VideoSuppliedMedia } from "@vanillaskyai/video";
// @ts-expect-error SceneTimeline is no longer public.
import type { SceneTimeline } from "@vanillaskyai/video";
// @ts-expect-error SceneTimelineOptions is no longer public.
import type { SceneTimelineOptions } from "@vanillaskyai/video";
// @ts-expect-error Standalone video generation is no longer public.
import { createVideoHandler } from "@vanillaskyai/video/server";
// @ts-expect-error VideoHandlerOptions is no longer public.
import type { VideoHandlerOptions } from "@vanillaskyai/video/server";
// @ts-expect-error MediaResolver is no longer public.
import type { MediaResolver } from "@vanillaskyai/video/server";
// @ts-expect-error MediaResolverContext is no longer public.
import type { MediaResolverContext } from "@vanillaskyai/video/server";
// @ts-expect-error ResolvedMedia is no longer public.
import type { ResolvedMedia } from "@vanillaskyai/video/server";
// @ts-expect-error Chat does not select soundtracks.
chatHandlerOptions.selectAudio;
// @ts-expect-error Chat does not retain source metadata.
chatHandlerOptions.snapshotRetention;
// @ts-expect-error Durable generation reconnect is not a chat option.
chatHandlerOptions.replay;
// @ts-expect-error Chat owns run identity.
chatHandlerOptions.createRunId;
// @ts-expect-error Handler behavior selectors are not callback-shaped.
chatHandlerOptions.onInvalidPart;
void [video.schemaVersion, parsedVideo, validationCode, validationError.code, chatHook.playerProps, chatWarnings, turnWarnings, createdChatVoice, videoChatProps, packedVideoChat, PackedChatTypeProbe, chatHandlerOptions.invalidPartBehavior, chatHandlerOptions.generateText, chatCapabilities.modes, summary, usage, warning, error.code, error.status, error.requestId, error.runId, savedPlayer, builtinId, builtinMetadata, family, sceneTemplate, sceneMetadata, sceneProps, templateRegistry, timingMetadata, transitionTiming];
`);
  writeFileSync(join(consumer, "types-tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: false }, include: ["types.ts"] }));
  execFileSync(process.execPath, [join(consumer, "node_modules", "typescript", "bin", "tsc"), "-p", "types-tsconfig.json"], { cwd: consumer, stdio: "inherit" });

  writeFileSync(join(consumer, "index.html"), '<main id="root"></main><script type="module" src="/main.jsx"></script>');
  cpSync(join(root, "tests", "browser", "fixtures", "media-transition", "waterfall.mp4"), join(consumer, "first.mp4"));
  writeFileSync(join(consumer, "card-poster.svg"), decodeURIComponent(JSON.parse(previewImageUrl).slice("data:image/svg+xml,".length)));
  cpSync(join(root, "tests", "browser", "fixtures", "media-transition", "tram.mp4"), join(consumer, "second.mp4"));
  writeFileSync(join(consumer, "main.jsx"), `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { VideoChat, VideoError, VideoPlayer, useVideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";
import { templates } from "./vanillasky/index.ts";
const mediaProbe = new URLSearchParams(window.location.search).has("media-probe");
const chatProbe = new URLSearchParams(window.location.search).has("chat-probe");
const video = {
  schemaVersion: "0.2",
  orientation: "portrait",
  scenes: [
    { id: "text", templateId: "minimal-text", variables: { headline: "Customer health", detail: "Activation is up 18%." }, timing: { fixedDuration: 2 } },
    { id: "data", templateId: "structured-data", variables: { label: "Activation", current: 58, previous: 41, unit: "%", explanation: "Guided onboarding helped more users reach value." }, timing: { fixedDuration: 2 } },
    { id: "builtin", templateId: "keyFigure", variables: { value: "42", label: "retention" }, timing: { fixedDuration: 1 } },
  ],
  style: {},
};
const mediaVideo = {
  ...video,
  scenes: [
    { id: "packed-media-one", templateId: "cinemaMedia", variables: { mediaUrl: "/first.mp4", mediaType: "video", mediaPoster: ${previewImageUrl} }, timing: { fixedDuration: 1.5 } },
    { id: "packed-media-two", templateId: "cinemaMedia", variables: { mediaUrl: "/second.mp4", mediaType: "video", mediaPoster: ${previewImageUrl} }, timing: { fixedDuration: 1.5 } },
  ],
};
const error = new VideoError("Safe browser error", { code: "video_failed", cause: new Error("provider secret") });
const videoChatFetcher = async (input) => {
  const action = new URL(String(input), globalThis.location.href).searchParams.get("action");
  if (action === "capabilities") return Response.json({ templates: true, generatedSpeech: false, generatedVideo: false, stockMedia: true, transcription: false, modes: ["cinematic", "pexels"] });
  if (action === "welcome") return Response.json({ hero: null, cards: [{ prompt: "Invent a tiny packed story", media: { type: "video", url: new URL("/first.mp4", globalThis.location.href).href, posterUrl: new URL("/card-poster.svg", globalThis.location.href).href } }] });
  return new Response("missing", { status: 404 });
};
const VideoChatHookProbe = () => {
  const chat = useVideoChat({ fetcher: videoChatFetcher });
  return createElement("output", { id: "video-chat-hook", "data-status": chat.status, "data-modes": chat.availableModes.join() });
};

createRoot(document.getElementById("root")).render(mediaProbe
  ? createElement("main", { "data-case": "source-owned-media" },
      createElement(VideoPlayer, { video: mediaVideo, templates, autoPlay: true, startMuted: true, loop: true, width: 360 }))
  : chatProbe
    ? createElement("main", { "data-case": "default-video-chat" },
        createElement("p", { id: "outside-video-chat" }, "Host application"),
        createElement(VideoChat, { options: { fetcher: videoChatFetcher }, className: "packed-video-chat" }))
  : createElement("main", null,
      createElement(VideoChatHookProbe),
      createElement(VideoPlayer, {
        video,
        templates,
        autoPlay: false,
        width: 360,
        onPlaybackEnd: () => { globalThis.document.documentElement.dataset.playbackEnded = "true"; },
        onFramePresented: () => { const data = globalThis.document.documentElement.dataset; data.presentedFrames = String(Number(data.presentedFrames ?? 0) + 1); },
      }),
      createElement("output", {
        id: "typed-error",
        "data-code": error.code,
        "data-has-cause": String(Object.prototype.hasOwnProperty.call(error, "cause")),
      }, error.message)));
`);
  execFileSync(process.execPath, [join(consumer, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: consumer, stdio: "inherit" });

  const preview = spawn(process.execPath, [
    join(consumer, "node_modules", "vite", "bin", "vite.js"),
    "--host", "127.0.0.1", "--port", "4387", "--strictPort",
  ], { cwd: consumer, stdio: "pipe" });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const browserErrors = [];
    let generationRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/video") generationRequests += 1;
    });
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    let opened = false;
    for (let attempt = 0; attempt < 40 && !opened; attempt += 1) {
      try {
        await page.goto("http://127.0.0.1:4387", { waitUntil: "networkidle", timeout: 1_000 });
        opened = true;
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
    }
    if (!opened) throw new Error("Packed consumer preview did not start");
    await page.waitForTimeout(500);
    await page.waitForFunction(() => globalThis.document.querySelector("#video-chat-hook")?.getAttribute("data-modes") === "cinematic,pexels");
    if (await page.locator("#video-chat-hook").getAttribute("data-status") !== "idle") {
      throw new Error("Packed video-chat hook did not initialize");
    }
    if (browserErrors.length > 0) throw new Error(`Packed consumer browser errors before playback:\n${browserErrors.join("\n")}`);
    await page.waitForSelector('[data-template-id="minimal-text"]');
    if ((await page.locator("body").textContent())?.includes("Activation is up 18%.") !== true) {
      throw new Error("Packed saved playback did not render the generated customer template");
    }
    const typedError = page.locator("#typed-error");
    if (await typedError.getAttribute("data-code") !== "video_failed") {
      throw new Error("Packed VideoError lost its safe code");
    }
    if (await typedError.getAttribute("data-has-cause") !== "false") {
      throw new Error("Packed VideoError exposed a raw provider cause");
    }
    await page.getByRole("button", { name: "Play video response" }).click();
    await page.waitForSelector('[data-template-id="structured-data"]', { timeout: 5_000 });
    await page.getByText("Guided onboarding helped more users reach value.").waitFor({ timeout: 5_000 });
    await page.waitForSelector('[data-template-id="keyFigure"]', { timeout: 5_000 });
    await page.getByText("retention").waitFor({ timeout: 5_000 });
    try {
      await page.waitForFunction(() => globalThis.document.documentElement.dataset.playbackEnded === "true", undefined, { timeout: 5_000 });
    } catch {
      throw new Error("Packed playback-end callback did not fire");
    }
    if (await page.evaluate(() => globalThis.document.documentElement.dataset.presentedFrames) !== "1") {
      throw new Error("Packed frame-presentation observer did not report the actual rendered response once");
    }
    if (generationRequests !== 0) throw new Error("Packed saved replay called the generation endpoint");
    if (browserErrors.length > 0) throw new Error(`Packed consumer browser errors:\n${browserErrors.join("\n")}`);

    await page.addInitScript(() => {
      if (!globalThis.location.search.includes("chat-probe")) return;
      globalThis.HTMLMediaElement.prototype.play = function () {
        return Promise.reject(new globalThis.DOMException("Autoplay blocked by test policy", "NotAllowedError"));
      };
      // Also block the native autoplay attribute, which bypasses play().
      new globalThis.MutationObserver(() => {
        for (const video of globalThis.document.querySelectorAll("video")) {
          video.autoplay = false;
          video.pause();
          video.dataset.packedAutoplayBlocked = "true";
        }
      }).observe(globalThis.document, { childList: true, subtree: true });
    });
    await page.goto("http://127.0.0.1:4387/?chat-probe=1", { waitUntil: "networkidle" });
    try {
      await page.getByText("in video, not text.").waitFor({ timeout: 5_000 });
      await page.getByRole("button", { name: "Invent a tiny packed story", exact: true }).waitFor({ timeout: 5_000 });
    } catch {
      throw new Error("Packed VideoChat welcome did not render");
    }
    const packedChat = page.locator(".packed-video-chat");
    if (await packedChat.evaluate((element) =>
      element.ownerDocument.defaultView?.getComputedStyle(element).boxSizing,
    ) !== "border-box") {
      throw new Error("Packed VideoChat stylesheet did not apply");
    }
    if (await page.locator("#outside-video-chat").evaluate((element) =>
      element.ownerDocument.defaultView?.getComputedStyle(element).boxSizing,
    ) !== "content-box") {
      throw new Error("Packed VideoChat stylesheet leaked into the host page");
    }
    // Exercise the installed package's shared navigation on desktop and phone.
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const preview = packedChat.getByRole("button", { name: "Invent a tiny packed story", exact: true }).locator("video");
      await preview.waitFor({ state: "visible" });
      const posterState = await preview.evaluate(async (video) => {
        const poster = video.getAttribute("poster");
        if (!poster) return { loaded: false };
        const image = new globalThis.Image();
        image.src = poster;
        await image.decode();
        return { loaded: image.naturalWidth > 0 && image.naturalHeight > 0, blocked: video.dataset.packedAutoplayBlocked === "true", paused: video.paused, autoplay: video.autoplay };
      });
      if (!posterState.loaded || !posterState.blocked || !posterState.paused || posterState.autoplay) {
        throw new Error("Packed card lost its loaded poster when autoplay was blocked: " + JSON.stringify(posterState));
      }
      const fallback = packedChat.getByRole("button", { name: "Invent a tiny packed story", exact: true }).locator("img.frame-poster");
      await fallback.waitFor({ state: "visible" });
      const fallbackState = await fallback.evaluate(async (image) => {
        await image.decode();
        const style = image.ownerDocument.defaultView.getComputedStyle(image);
        const previousVideo = image.previousElementSibling;
        return image.naturalWidth > 0 && image.naturalHeight > 0
          && style.visibility === "visible" && Number(style.opacity) > 0
          && previousVideo?.tagName === "VIDEO";
      });
      if (!fallbackState) throw new Error("Packed card did not paint its explicit poster fallback above the blocked video");
      if (process.env.VANILLASKY_PACKED_SCREENSHOT_DIR) {
        mkdirSync(process.env.VANILLASKY_PACKED_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ animations: "disabled", path: join(process.env.VANILLASKY_PACKED_SCREENSHOT_DIR, viewport.width < 600 ? "card-posters-mobile.png" : "card-posters-desktop.png") });
      }
      const navigation = packedChat.locator(".chrome");
      if (await navigation.getByRole("button", { name: "New session", exact: true }).count()
        || await navigation.getByRole("button", { name: "History", exact: true }).count()) {
        throw new Error("Packed navigation exposed standalone session actions");
      }
      const sessions = packedChat.getByRole("button", { name: "Sessions", exact: true });
      await sessions.focus();
      await sessions.press("Enter");
      const menu = packedChat.getByRole("dialog", { name: "Sessions", exact: true });
      await menu.waitFor({ state: "visible" });
      await menu.getByRole("button", { name: "New session", exact: true }).waitFor({ state: "visible" });
      const fits = await menu.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= globalThis.innerWidth && bounds.top >= 0 && bounds.bottom <= globalThis.innerHeight;
      });
      if (!fits) throw new Error("Packed Sessions menu overflowed the viewport");
      if (process.env.VANILLASKY_PACKED_SCREENSHOT_DIR) {
        mkdirSync(process.env.VANILLASKY_PACKED_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ animations: "disabled", path: join(process.env.VANILLASKY_PACKED_SCREENSHOT_DIR, viewport.width < 600 ? "session-controls-mobile.png" : "session-controls-desktop.png") });
      }
      await menu.getByRole("button", { name: "Close sessions", exact: true }).click();
      await menu.waitFor({ state: "hidden" });
      if (!await sessions.evaluate((button) => button.ownerDocument.activeElement === button)) {
        throw new Error("Packed Sessions dismissal did not restore trigger focus");
      }
      await packedChat.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = packedChat.getByRole("dialog", { name: "Settings", exact: true });
      await settings.waitFor({ state: "visible" });
      const settingsState = await settings.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          headings: Array.from(element.querySelectorAll("fieldset legend"), (item) => item.textContent),
          switches: element.querySelectorAll('[role="switch"]').length,
          sources: Array.from(element.querySelectorAll('input[type="radio"]'), input => input.value),
          obsoleteChoices: element.querySelectorAll(".visual-options, .style-options").length,
          fits: box.left >= 0 && box.right <= globalThis.innerWidth && box.top >= 0 && box.bottom <= globalThis.innerHeight,
        };
      });
      if (settingsState.headings.join() !== "Video source,Watching" || settingsState.sources.join() !== "cinematic,pexels" || settingsState.switches !== 2 || settingsState.obsoleteChoices || !settingsState.fits) {
        throw new Error("Packed Settings lost media choices, watching controls, or introduced removed choices: " + JSON.stringify(settingsState));
      }
      await settings.locator('input[value="pexels"]').check();
      if (!await settings.locator('input[value="pexels"]').isChecked()) throw new Error("Packed Settings cannot select Pexels");
      await settings.locator('input[value="cinematic"]').check();
      if (!await settings.locator('input[value="cinematic"]').isChecked()) throw new Error("Packed Settings cannot restore AI mode");
      if (process.env.VANILLASKY_PACKED_SCREENSHOT_DIR) {
        await page.screenshot({ animations: "disabled", path: join(process.env.VANILLASKY_PACKED_SCREENSHOT_DIR, viewport.width < 600 ? "settings-spacing-mobile.png" : "settings-spacing-desktop.png") });
      }
      await settings.getByRole("button", { name: "Close settings", exact: true }).click();
      await settings.waitFor({ state: "hidden" });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light", contrast: "more" });
    const contrastColors = await packedChat.evaluate((element) => {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      return {
        background: style?.getPropertyValue("--vs-media-glass").trim(),
        muted: style?.getPropertyValue("--vs-media-muted").trim(),
      };
    });
    if (contrastColors.background !== "#121622" || contrastColors.muted !== "#e4e5ef") {
      throw new Error("Packed VideoChat increased-contrast glass drifted");
    }
    if (browserErrors.length > 0) throw new Error(`Packed VideoChat browser errors:\n${browserErrors.join("\n")}`);

    const iphonePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    });
    await iphonePage.addInitScript(() => {
      globalThis.__packedMaxVideoCount = 0;
      const sample = () => {
        globalThis.__packedMaxVideoCount = Math.max(
          globalThis.__packedMaxVideoCount,
          globalThis.document.querySelectorAll("video").length,
        );
      };
      new globalThis.MutationObserver(sample).observe(globalThis.document, { childList: true, subtree: true });
      sample();
    });
    await iphonePage.goto("http://127.0.0.1:4387/?media-probe=1");
    await iphonePage.locator('[data-scene-id="packed-media-one"]').waitFor({ timeout: 4_000 });
    await iphonePage.waitForFunction(() => globalThis.document.querySelectorAll("video").length === 1);
    const sourceVideo = iphonePage.locator("video");
    await sourceVideo.evaluate((element) => { element.dataset.packedPersistentVideo = "true"; });
    const activeSurface = iphonePage.locator('[data-scene-layer="active"] > div').first();
    if (await activeSurface.evaluate((element) =>
      element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor,
    ) !== "rgba(0, 0, 0, 0)") {
      throw new Error("Source-owned template occluded the player video plane");
    }
    await iphonePage.locator('[data-scene-id="packed-media-two"]').waitFor({ timeout: 4_000 });
    if (await iphonePage.locator("video").count() !== 1
      || await iphonePage.locator("video").getAttribute("data-packed-persistent-video") !== "true"
      || await iphonePage.evaluate(() => globalThis.__packedMaxVideoCount) > 1) {
      throw new Error("Source-owned template replaced or duplicated the player video plane");
    }
    await iphonePage.close();
  } finally {
    await browser.close();
    preview.kill("SIGTERM");
  }

  writeFileSync(join(react19Consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball,
    "react@19.2.8", "react-dom@19.2.8", "vite@8.2.2",
  ], { cwd: react19Consumer, stdio: "inherit" });
  writeFileSync(join(react19Consumer, "index.html"), '<main id="root"></main><script type="module" src="/main.jsx"></script>');
  writeFileSync(join(react19Consumer, "main.jsx"), `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { VideoPlayer } from "@vanillaskyai/video/react";
import { createTemplateRegistry, defineTemplate } from "@vanillaskyai/video/templates";

const schema = { type: "object", properties: {}, additionalProperties: false };
const probe = (id) => defineTemplate({
  id,
  useWhen: "The packed transition peer gate selects this deterministic probe.",
  usesGlobalTransition: true,
  transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
  schema,
  component: ({ progress, motionProgress, variables }) => createElement("button", {
    "data-probe": id,
    "data-progress": progress.toFixed(3),
    "data-motion-progress": motionProgress?.toFixed(3),
  }, id, variables.mediaUrl ? createElement("img", { src: variables.mediaUrl, width: 32, height: 18, alt: "Probe background" }) : null, createElement("span", {
    "data-transition-semantic": "transient",
    style: { visibility: "var(--vanillasky-transition-semantic-visibility, visible)" },
  }, "0x")),
});
const definitions = [
  probe("react19-opening"),
  probe("react19-incoming"),
  probe("react19-undefined"),
  probe("react19-unknown"),
  probe("react19-isolated"),
];
const templates = createTemplateRegistry({ definitions });
const video = {
  schemaVersion: "0.2",
  orientation: "portrait",
  scenes: [
    { id: "react19-opening-scene", templateId: "react19-opening", variables: { mediaUrl: ${previewImageUrl}, mediaType: "photo" }, timing: { fixedDuration: 0.6 } },
    { id: "react19-incoming-scene", templateId: "react19-incoming", variables: { mediaUrl: ${JSON.stringify("data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#143D24"/></svg>'))}, mediaType: "photo" }, timing: { fixedDuration: 0.6 } },
  ],
  style: {
    defaultTransition: "crossfade",
  },
};
const sharedBackgroundVideo = {
  ...video,
  scenes: video.scenes.map((scene) => ({ ...scene, variables: {} })),
};
const isolatedVideo = (id, defaultTransition) => ({
  schemaVersion: "0.2",
  orientation: "portrait",
  scenes: [{ id: id + "-scene", templateId: id, variables: {}, timing: { fixedDuration: 1 } }],
  style: { ...(defaultTransition === undefined ? {} : { defaultTransition }) },
});
const players = [
  { id: "transition", label: "React 19 transition probe", video },
  { id: "shared", label: "React 19 shared-background probe", video: sharedBackgroundVideo },
  { id: "undefined", label: "React 19 undefined hard-cut probe", video: isolatedVideo("react19-undefined", undefined) },
  { id: "unknown", label: "React 19 unknown hard-cut probe", video: isolatedVideo("react19-unknown", "wipe") },
  { id: "isolated", label: "React 19 isolated crossfade probe", video: isolatedVideo("react19-isolated", "crossfade") },
];
createRoot(document.getElementById("root")).render(createElement("main", null,
  players.map((player) => createElement("section", { key: player.id, "data-case": player.id },
    createElement(VideoPlayer, {
      video: player.video,
      templates,
      autoPlay: false,
      width: 360,
      ariaLabel: player.label,
    }),
  )),
));
`);
  const react19Preview = spawn(process.execPath, [
    join(react19Consumer, "node_modules", "vite", "bin", "vite.js"),
    "--host", "127.0.0.1", "--port", "4391", "--strictPort",
  ], { cwd: react19Consumer, stdio: "pipe" });
  const react19Browser = await chromium.launch({ headless: true });
  try {
    const page = await react19Browser.newPage();
    const browserErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    let opened = false;
    for (let attempt = 0; attempt < 40 && !opened; attempt += 1) {
      try {
        await page.goto("http://127.0.0.1:4391", { waitUntil: "networkidle", timeout: 1_000 });
        opened = true;
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
    }
    if (!opened) throw new Error("React 19 transition consumer did not start");
    await page.clock.install();
    await page.clock.pauseAt(Date.now() + 1_000);
    const startedPlayers = await page
      .locator('[data-case] button[aria-label="Play video response"]')
      .evaluateAll((buttons) => {
        for (const button of buttons) button.click();
        return buttons.length;
      });
    if (startedPlayers !== 5) {
      throw new Error("React 19 transition players did not start synchronously");
    }
    await page.clock.runFor(450);
    const transitionCase = page.locator('[data-case="transition"]');
    await transitionCase.locator('[data-scene-layer="outgoing"]').waitFor({ timeout: 4_000 });
    const outgoingProgress = await transitionCase.locator('[data-scene-layer="outgoing"] [data-probe]').evaluate((element) => ({
      raw: Number(element.getAttribute("data-progress")),
      motion: Number(element.getAttribute("data-motion-progress")),
    }));
    if (!Number.isFinite(outgoingProgress.raw) || !Number.isFinite(outgoingProgress.motion)
      || outgoingProgress.raw <= 0.5 || outgoingProgress.raw >= 1
      || Math.abs(outgoingProgress.raw - outgoingProgress.motion) > 0.0005) {
      throw new Error("React 19 transition did not preserve the outgoing template timeline");
    }
    const incomingProgress = await transitionCase.locator('[data-scene-layer="incoming"] [data-probe]').evaluate((element) => ({
      raw: Number(element.getAttribute("data-progress")),
      motion: Number(element.getAttribute("data-motion-progress")),
    }));
    const incomingOpacity = Number(await transitionCase
      .locator('[data-scene-layer="incoming"]')
      .evaluate((element) => element.ownerDocument.defaultView?.getComputedStyle(element).opacity));
    if (!Number.isFinite(incomingProgress.raw) || !Number.isFinite(incomingProgress.motion)
      || !Number.isFinite(incomingOpacity) || incomingOpacity <= 0 || incomingOpacity >= 1
      || incomingProgress.raw !== 0
      || incomingProgress.motion !== 0) {
      throw new Error("React 19 transition preview advanced the incoming template timeline");
    }
    const incomingTransientSemantic = transitionCase.locator('[data-scene-layer="incoming"] [data-transition-semantic="transient"]');
    if (await incomingTransientSemantic.evaluate((element) => element.ownerDocument.defaultView?.getComputedStyle(element).visibility) !== "hidden") {
      throw new Error("Packed transition exposed transient placeholder semantics");
    }
    const sharedCase = page.locator('[data-case="shared"]');
    if (await sharedCase.locator('[data-scene-layer="outgoing"], [data-scene-layer="incoming"]').count() !== 0) {
      throw new Error("React 19 shared background incorrectly crossfaded scene layers");
    }
    const sharedProgress = await sharedCase.locator('[data-scene-layer="active"] [data-probe]').evaluate((element) => ({
      raw: Number(element.getAttribute("data-progress")),
      motion: Number(element.getAttribute("data-motion-progress")),
    }));
    if (!Number.isFinite(sharedProgress.raw) || !Number.isFinite(sharedProgress.motion)
      || sharedProgress.raw <= 0 || sharedProgress.raw >= 1
      || Math.abs(sharedProgress.raw - sharedProgress.motion) > 0.0005) {
      throw new Error("React 19 shared background did not preserve native template motion");
    }
    for (const [id, message] of [
      ["undefined", "React 19 undefined hard-cut motion progress diverged from raw progress"],
      ["unknown", "React 19 unknown hard-cut motion progress diverged from raw progress"],
      ["isolated", "React 19 isolated crossfade motion progress diverged from raw progress"],
    ]) {
      const progress = await page.locator(`[data-case="${id}"] [data-probe]`).evaluate((element) => ({
        raw: Number(element.getAttribute("data-progress")),
        motion: Number(element.getAttribute("data-motion-progress")),
      }));
      if (!Number.isFinite(progress.raw) || !Number.isFinite(progress.motion)
        || progress.raw <= 0 || progress.raw >= 1
        || Math.abs(progress.raw - progress.motion) > 0.0005) throw new Error(message);
    }
    const hiddenLayer = transitionCase.locator("[data-scene-layer][inert]");
    if (await hiddenLayer.count() !== 1
      || !await hiddenLayer.evaluate((element) => element.hasAttribute("inert"))) {
      throw new Error("React 19 transition layer did not retain inert focus isolation");
    }
    const hiddenButton = hiddenLayer.locator("button");
    if (await hiddenButton.evaluate((button) => {
      button.focus();
      return button.ownerDocument.activeElement === button;
    })) throw new Error("React 19 transition layer did not retain inert focus isolation");
    if (await transitionCase.locator('[data-video-frame="ready"][data-scene-id]').count() !== 1
      || await transitionCase.locator("[data-layer-scene-id]").count() !== 2) {
      throw new Error("React 19 transition scene identity was duplicated or missing");
    }
    await page.clock.runFor(650);
    for (const id of ["undefined", "unknown", "isolated"]) {
      const progress = await page.locator(`[data-case="${id}"] [data-probe]`).evaluate((element) => ({
        raw: Number(element.getAttribute("data-progress")),
        motion: Number(element.getAttribute("data-motion-progress")),
      }));
      if (progress.raw !== 1 || progress.motion !== 0.7) {
        throw new Error("React 19 terminal poster did not settle at the readable hold frame");
      }
    }
    await transitionCase.locator('[data-scene-layer="active"][data-layer-scene-id="react19-incoming-scene"]').waitFor({ timeout: 4_000 });
    const settledProgress = await transitionCase.locator('[data-scene-layer="active"] [data-probe]').evaluate((element) => ({
      raw: Number(element.getAttribute("data-progress")),
      motion: Number(element.getAttribute("data-motion-progress")),
    }));
    if (!Number.isFinite(settledProgress.raw) || !Number.isFinite(settledProgress.motion)
      || settledProgress.raw <= 0.7 || settledProgress.raw >= 1
      || settledProgress.motion !== 0.7) {
      throw new Error("React 19 settled final scene did not preserve the readable hold frame");
    }
    const activeTransientSemantic = transitionCase.locator('[data-scene-layer="active"] [data-transition-semantic="transient"]');
    if (await activeTransientSemantic.evaluate((element) => element.ownerDocument.defaultView?.getComputedStyle(element).visibility) !== "visible") {
      throw new Error("Packed settled scene kept transient semantics hidden");
    }
    if (browserErrors.length > 0) throw new Error(`React 19 transition browser errors:\n${browserErrors.join("\n")}`);
  } finally {
    await react19Browser.close();
    react19Preview.kill("SIGTERM");
  }

  verifyPackedMarkdownDocumentation({ packageRoot, repositoryRoot: root });
  for (const relative of ["dist/index.js", "dist/server.js", "dist/react.js", "dist/templates.js", "dist/template-catalog.js", "dist/test.js", "dist/check-runtime.js", "styles/video-chat.css", "bin/vanillasky.js", "registry/items/mobileMessage.json"]) {
    if (!existsSync(join(packageRoot, relative))) throw new Error(`Packed package is missing ${relative}`);
  }
  execFileSync(process.execPath, [join(packageRoot, "bin", "vanillasky.js"), "templates", "list"], { cwd: consumer, stdio: "ignore" });
  console.log(`Packed SDK artifact ${selectedArtifact.integrity} created, checked, built, parsed, and replayed with zero generation requests.`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
