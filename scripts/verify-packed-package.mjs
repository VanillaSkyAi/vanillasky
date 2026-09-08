#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { parseNpmPackJson } from "./lib/parse-npm-pack-json.mjs";
import { selectPackedArtifact } from "./lib/release-integrity.mjs";
import { verifyPublicApiSurface } from "./lib/public-api-surface.mjs";
import { verifyPackedMarkdownDocumentation } from "./lib/packed-markdown.mjs";
import { stopProcessTree } from "./lib/stop-process-tree.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), "vanillasky-packed-consumer-"));
const serverConsumer = join(workspace, "server");
const consumer = join(workspace, "browser");
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });
const write = (directory, name, content) => writeFileSync(join(directory, name), content);
const strict = { strict: true, noUnusedLocals: true, noUnusedParameters: true, noEmit: true,
  target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx",
  lib: ["ES2022", "DOM", "DOM.Iterable"], skipLibCheck: false };
const story = JSON.stringify({ type: "answer", intent: "informational",
  opening: "Waves move toward the shore.", subject: "ocean waves", development: "",
  visualDirection: "Natural ocean footage.", ending: { title: "Waves carry energy",
    narration: "Ocean waves carry energy toward the shore.", subject: "ocean waves",
    action: "Follow waves rolling toward the shore.", durationSec: 4, continuity: "cut" } }) + "\n";
let preview;
let browser;
try {
  mkdirSync(serverConsumer);
  mkdirSync(consumer);
  const artifact = selectPackedArtifact({
    providedPath: process.env.VANILLASKY_PACKED_TARBALL ? resolve(process.env.VANILLASKY_PACKED_TARBALL) : undefined,
    expectedIntegrity: process.env.VANILLASKY_EXPECTED_INTEGRITY,
    expectedSha256: process.env.VANILLASKY_EXPECTED_SHA256,
    packArtifact: () => {
      const [packed] = parseNpmPackJson(execFileSync("npm", ["pack", "--silent", "--json", "--ignore-scripts", "--pack-destination", workspace], { cwd: root, encoding: "utf8" }));
      return { path: join(workspace, packed.filename), integrity: packed.integrity };
    },
  });
  const oldFixture = readFileSync(join(root, "tests/fixtures/persisted-video-0.1.0.json"), "utf8");
  if (createHash("sha256").update(oldFixture).digest("hex") !== "eef80e45cd501c3f29a3636d0a0bb34c10da0bf19e205713cedec2bb709bafc4") {
    throw new Error("The immutable old persisted-video fixture changed");
  }
  write(serverConsumer, "package.json", JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", artifact.path, "typescript@5.9.3"], serverConsumer);
  for (const dependency of ["react", "@types/react", "tsx", "esbuild"]) {
    if (existsSync(join(serverConsumer, "node_modules", dependency))) throw new Error("Server-only install pulled " + dependency);
  }
  write(serverConsumer, "types.ts", [
    'import { createVideoChatHandler } from "@vanillaskyai/video/server";',
    'import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";',
    'import { parseVideo } from "@vanillaskyai/video";',
    'import { createMockVideoPlanner, simulateVideoStream, videoFixtures } from "@vanillaskyai/video/test";',
    'declare const options: VideoChatHandlerOptions;',
    'void [createVideoChatHandler(options), parseVideo, createMockVideoPlanner, simulateVideoStream, videoFixtures];',
  ].join("\n"));
  write(serverConsumer, "tsconfig.json", JSON.stringify({ compilerOptions: strict, include: ["types.ts"] }));
  run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], serverConsumer);
  write(serverConsumer, "check.mjs", [
    'import assert from "node:assert/strict";',
    'import { parseVideo, VideoValidationError } from "@vanillaskyai/video";',
    'import { createVideoChatHandler } from "@vanillaskyai/video/server";',
    'import { simulateVideoStream, videoFixtures } from "@vanillaskyai/video/test";',
    'const story = ' + JSON.stringify(story) + ';',
    'const parse = text => text.split("\\n").filter(line => line.startsWith("data: ") && line !== "data: [DONE]").map(line => JSON.parse(line.slice(6)));',
    'const post = (mode = "cinematic", signal) => new Request("https://app.test/api/video-chat?action=response", { method: "POST", body: JSON.stringify({prompt: "Explain waves", mode}), signal });',
    'let generated = 0, searched = 0, missing = false;',
    'const base = { authorize: "none", heartbeatMs: false, streamText: async function* () { yield story; }, generateText: async () => "[]" };',
    'const handler = createVideoChatHandler({ ...base, generateVideo: async () => { generated++; return missing ? null : {type: "video", url: "https://media.example/fixture.mp4"}; }, searchMedia: async () => { searched++; return {type: "video", url: "https://media.example/stock.mp4"}; } });',
    'const generatedEvents = parse(await (await handler(post())).text());',
    'assert.equal(generated, 1); assert.equal(searched, 0);',
    'const completed = generatedEvents.at(-1); assert.equal(completed.type, "response.complete");',
    'const video = parseVideo(completed.data.snapshot); assert.ok(Object.isFrozen(video.scenes));',
    'assert.equal(video.scenes[0].templateId, "cinemaMedia"); assert.ok(completed.data.checksum);',
    'assert.ok(generatedEvents.findIndex(e => e.type === "data.video-chat-opening") < generatedEvents.findIndex(e => e.type === "scene.add"));',
    'const stock = parse(await (await handler(post("pexels"))).text());',
    'assert.equal(searched, 1); assert.equal(generated, 1); assert.equal(stock.at(-1).type, "response.complete");',
    'missing = true; const recovered = parse(await (await handler(post())).text()).at(-1);',
    'assert.equal(recovered.data.snapshot.scenes[0].templateId, "chapterTitle"); assert.equal(recovered.data.snapshot.scenes[0].narration, video.scenes[0].narration);',
    'const noSpend = createVideoChatHandler({...base, maxGeneratedVideos: 0, generateVideo: () => { throw new Error("Must not spend"); }});',
    'assert.equal(parse(await (await noSpend(post())).text()).at(-1).data.snapshot.scenes[0].templateId, "chapterTitle");',
    'const denied = createVideoChatHandler({...base, authorize: () => false}); assert.equal((await denied(post())).status, 401);',
    'const failed = createVideoChatHandler({...base, streamText: async function* () { throw new Error("PRIVATE_PROVIDER_CANARY"); }});',
    'const failure = await (await failed(post())).text(); assert.ok(failure.includes("response.error")); assert.ok(!failure.includes("PRIVATE_PROVIDER_CANARY"));',
    'let entered; const started = new Promise(resolve => { entered = resolve; }); let cancelled = false;',
    'const cancellable = createVideoChatHandler({...base, streamText: async function* ({signal}) { entered(); await new Promise(resolve => signal.addEventListener("abort", () => { cancelled = true; resolve(); }, {once: true})); }});',
    'const abort = new AbortController(); const response = await cancellable(post("cinematic", abort.signal)); const body = response.text();',
    'await started; abort.abort(); await body; assert.equal(cancelled, true);',
    'assert.throws(() => parseVideo(' + oldFixture.trim() + '), error => error instanceof VideoValidationError && error.code === "unsupported_video_version");',
    'for (const scenario of ["success", "truncated", "invalidScene", "providerFailure"]) { const events = []; const parts = videoFixtures.scenarios[scenario]; for await (const event of simulateVideoStream(parts)) events.push(event); assert.equal(events.at(-1).type, scenario === "providerFailure" ? "response.error" : "response.complete"); if (scenario === "truncated") assert.equal(events.at(-1).data.finishReason, "length"); assert.ok(!JSON.stringify(events).includes("fixture-private-value")); }',
  ].join("\n"));
  execFileSync(process.execPath, ["check.mjs"], { cwd: serverConsumer, stdio: "inherit", timeout: 30_000 });

  write(consumer, "package.json", JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", artifact.path,
    "react@18.3.1", "react-dom@18.3.1", "@types/react@18.3.28", "@types/react-dom@18.3.7", "typescript@5.9.3", "vite@8.2.2"], consumer);
  const packageRoot = join(consumer, "node_modules/@vanillaskyai/video");
  await verifyPublicApiSurface({ packageRoot, manifestPath: join(root, "tests/fixtures/public-api-surface.json"), signaturePath: join(root, "tests/fixtures/public-api-signatures.json") });
  verifyPackedMarkdownDocumentation({ packageRoot, repositoryRoot: root });
  write(consumer, "index.html", '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
  write(consumer, "main.tsx", [
    'import { useState } from "react";',
    'import { createRoot } from "react-dom/client";',
    'import { parseVideo } from "@vanillaskyai/video";',
    'import { VideoChat, VideoPlayer } from "@vanillaskyai/video/react";',
    'import "@vanillaskyai/video/video-chat.css";',
    'const saved = parseVideo({schemaVersion:"0.2", orientation:"landscape", style:{}, scenes:[{id:"chapter",templateId:"chapterTitle",variables:{title:"A saved response"},timing:{fixedDuration:1}},{id:"footage",templateId:"cinemaMedia",variables:{mediaUrl:"https://media.example/fixture.mp4",mediaType:"video",fallbackText:"Waves carry energy"},timing:{fixedDuration:1}}]});',
    'function App() { const [ended, setEnded] = useState(false); return new URLSearchParams(location.search).has("replay") ? <><VideoPlayer video={saved} autoPlay startMuted onPlaybackEnd={() => setEnded(true)} /><output aria-label="Replay status">{ended ? "Ended" : "Playing"}</output></> : <><p id="outside">Host page</p><VideoChat options={{ initialMuted: true }} /></>; }',
    'createRoot(document.getElementById("root")!).render(<App />);',
  ].join("\n"));
  const persistenceGuide = readFileSync(join(packageRoot, "docs/persistence.md"), "utf8");
  const snippet = persistenceGuide.match(/<!-- verify:persistence-example:start -->\s*\x60{3}tsx\r?\n([\s\S]*?)\r?\n\x60{3}\s*<!-- verify:persistence-example:end -->/)?.[1];
  if (!snippet) throw new Error("Persistence guide lacks its compilable public example");
  write(consumer, "persistence-example.tsx", snippet);
  write(consumer, "tsconfig.json", JSON.stringify({ compilerOptions: strict, include: ["*.tsx"] }));
  run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], consumer);
  run(process.execPath, ["node_modules/vite/bin/vite.js", "build"], consumer);
  const chunks = readdirSync(join(consumer, "dist/assets")).filter(name => name.endsWith(".js"));
  const bundle = chunks.map(name => readFileSync(join(consumer, "dist/assets", name), "utf8")).join("\n");
  for (const privateValue of ["PRIVATE_PROVIDER_CANARY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "node:fs"]) {
    if (bundle.includes(privateValue)) throw new Error("Browser bundle exposed " + privateValue);
  }
  preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4387", "--strictPort"], { cwd: consumer, stdio: "ignore", detached: process.platform !== "win32" });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (preview.exitCode != null) throw new Error("Packed browser preview exited");
    try { if ((await fetch("http://127.0.0.1:4387")).ok) break; } catch { /* starting */ }
    if (attempt === 99) throw new Error("Packed browser preview timed out");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const { createVideoChatHandler } = await import(pathToFileURL(join(packageRoot, "dist/server.js")).href);
  const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false,
    streamText: async function* () { yield story; }, generateText: async () => "[]",
    welcome: { heroQuery: "", prompts: [{ prompt: "Explain waves" }] },
    generateVideo: async () => ({ type: "video", url: "https://media.example/fixture.mp4" }) });
  browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: "no-preference" });
  const errors = [];
  let generationRequests = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("https://media.example/fixture.mp4", route => route.fulfill({ contentType: "video/mp4", body: readFileSync(join(root, "tests/browser/fixtures/media-transition/waterfall.mp4")) }));
  await page.route("**/api/video-chat**", async route => {
    const request = route.request();
    if (new URL(request.url()).searchParams.get("action") === "response") generationRequests++;
    const response = await handler(new Request(request.url(), { method: request.method(), headers: request.headers(), ...(request.method() === "POST" ? { body: request.postData() } : {}) }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  await page.goto("http://127.0.0.1:4387");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Explain ocean waves");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.locator('[data-template-id="cinemaMedia"]').first().waitFor({ timeout: 15_000 });
  if (generationRequests !== 1) throw new Error("One visible submission issued multiple generation requests");
  if (await page.locator("#outside").evaluate(element => element.ownerDocument.defaultView.getComputedStyle(element).color) !== "rgb(0, 0, 0)") throw new Error("VideoChat CSS leaked into the host page");
  await page.goto("http://127.0.0.1:4387/?replay");
  await page.getByLabel("Replay status").filter({ hasText: "Ended" }).waitFor({ timeout: 10_000 });
  if (generationRequests !== 1) throw new Error("Saved replay issued a generation request");
  if (errors.length) throw new Error("Packed browser errors: " + errors.join(" | "));
  console.log("Packed default chat, storage/replay, strict types, provider cancellation, recovery and browser/server boundaries passed: " + artifact.integrity);
} finally {
  if (browser) await browser.close();
  if (preview) await stopProcessTree(preview);
  rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
