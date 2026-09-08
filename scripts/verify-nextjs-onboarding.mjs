#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { parseNpmPackJson } from "./lib/parse-npm-pack-json.mjs";
import {
  selectPackedArtifact,
} from "./lib/release-integrity.mjs";
import { stopProcessTree } from "./lib/stop-process-tree.mjs";

// This deterministic gate must not inherit or inspect provider credentials.
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = join(root, "tests", "fixtures", "nextjs-provider-app");
const providers = ["openai", "anthropic"];
const commandLog = [];
const retainedProviderEvidence = [];
const providerEvidenceFilename = "provider-evidence.json";
const routeRelative = "src/app/api/video-chat/route.ts";
const plannerRelative = "src/app/api/video-chat/planner.ts";
const clientRelative = "src/app/page.tsx";
const tsconfigRelative = "tsconfig.json";
const routeHash = hashFile(join(source, routeRelative));
const plannerHash = hashFile(join(source, plannerRelative));
const clientHash = hashFile(join(source, clientRelative));
const tsconfigHash = hashFile(join(source, tsconfigRelative));
const providerMetadataSentinel = "SERVER_ONLY_PROVIDER_METADATA_7e6a63f1";
const credentialEnvironmentNames = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};
const fakeProviderCredentials = {
  openai: ["fake", "openai", "credential", "sentinel", "first"].join("-"),
  anthropic: ["fake", "anthropic", "credential", "sentinel", "second"].join("-"),
};
const aiVersion = "7.0.77";
const aiIntegrity = "sha512-muLtBSTAUCreR77L16w4AFBiX2gK/RNt84EKp8m03SN9+MfNlC5EGqYYttRjYKV3xe0a33yj1Zawj1EnjejIWw==";
const compatibilityProviders = [
  {
    provider: "google",
    fixtureOnly: true,
    packageName: "@ai-sdk/google",
    version: "4.0.50",
    integrity: "sha512-n7aMmqw6ZGVNBDAiv89fZkuZp3ahfzwZTXsdW27WugXdFSIuLTlYBZ+FlKGRdk1pRMPrdIGT2GPL2Ra0Gc2Tkg==",
    configuredModel: "gemini-2.5-flash",
    resolvedModel: "gemini-2.5-flash",
    providerSentinel: "server-only-google-provider-selected",
    credentialName: "GOOGLE_GENERATIVE_AI_API_KEY",
    credential: ["synthetic", "google", "authorization", "sentinel"].join("-"),
  },
  {
    provider: "openrouter",
    fixtureOnly: true,
    packageName: "@openrouter/ai-sdk-provider",
    version: "3.0.0",
    integrity: "sha512-m9XTSWoODH2RM5OsZpaGiN7QRR8cdP5paBWq699Tu3JVmGPBKT8xF8XwV0ZBVVsjikD/JgWfak4VSsTR4wAVbg==",
    configuredModel: "openai/gpt-oss-compat",
    resolvedModel: "upstream/gpt-oss-resolved",
    providerSentinel: "server-only-openrouter-provider-selected",
    credentialName: "OPENROUTER_API_KEY",
    credential: ["synthetic", "openrouter", "authorization", "sentinel"].join("-"),
  },
];
const requestedProvider = process.env.VANILLASKY_PROVIDER?.trim();
const supportedProviders = [
  ...providers,
  ...compatibilityProviders.map(({ provider }) => provider),
];
if (requestedProvider && !supportedProviders.includes(requestedProvider)) {
  throw new Error(`Unsupported provider compatibility target: ${requestedProvider}`);
}
const selectedProviders = requestedProvider
  ? providers.filter((provider) => provider === requestedProvider)
  : providers;
const selectedCompatibilityProviders = requestedProvider
  ? compatibilityProviders.filter(({ provider }) => provider === requestedProvider)
  : compatibilityProviders;
const workspace = mkdtempSync(join(tmpdir(), "vanillasky-nextjs-providers-"));
const npmCache = join(workspace, "npm-cache");
const compatibilityCredentialForbiddenValues = compatibilityProviders.flatMap((provider) => [
  { label: `${provider.provider} credential name`, value: provider.credentialName },
  { label: `${provider.provider} synthetic credential`, value: provider.credential },
]);
const credentialForbiddenValues = [
  { label: "OpenAI credential name", value: credentialEnvironmentNames.openai },
  { label: "Anthropic credential name", value: credentialEnvironmentNames.anthropic },
  { label: "OpenAI fake credential", value: fakeProviderCredentials.openai },
  { label: "Anthropic fake credential", value: fakeProviderCredentials.anthropic },
  ...compatibilityCredentialForbiddenValues,
];
const expectedUsage = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
};
const expectedCompatibilityUsage = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};
const providerExpectations = {
  openai: {
    configuredModel: "openai-config-model",
    resolvedModel: "openai-selected-model",
    providerSentinel: "server-only-openai-adapter-selected",
  },
  anthropic: {
    configuredModel: "anthropic-config-model",
    resolvedModel: "anthropic-selected-model",
    providerSentinel: "server-only-anthropic-adapter-selected",
  },
};

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function allocateLocalPort() {
  const server = createServer();
  server.unref();
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local verification port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function childEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    CI: process.env.CI,
    NO_COLOR: "1",
    npm_config_cache: npmCache,
    ...extra,
  };
}

function run(command, args, cwd, environment = {}) {
  commandLog.push(`${cwd}$ ${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: childEnvironment(environment),
  });
}

function copyExample(app) {
  cpSync(source, app, {
    recursive: true,
    filter: (path) => !["node_modules", ".next", ".env.local"].includes(basename(path)),
  });
}

function deterministicProviderSource(provider) {
  const exportName = provider === "openai" ? "createOpenAIModel" : "createAnthropicModel";
  const expectation = providerExpectations[provider];
  const credentialEnvironmentName = credentialEnvironmentNames[provider];
  const expectedCredential = fakeProviderCredentials[provider];
  return `import "server-only";
import { MockLanguageModelV4 } from "ai/test";

const configuredModel = ${JSON.stringify(expectation.configuredModel)};
const resolvedModel = ${JSON.stringify(expectation.resolvedModel)};
const providerSentinel = ${JSON.stringify(expectation.providerSentinel)};
const providerMetadataSentinel = ${JSON.stringify(providerMetadataSentinel)};
const credentialEnvironmentName = ${JSON.stringify(credentialEnvironmentName)};
const expectedCredential = ${JSON.stringify(expectedCredential)};
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

export function ${exportName}(modelId: string) {
  if (modelId !== configuredModel) {
    throw new Error("Wrong provider adapter received model " + modelId);
  }
  const credential = process.env[credentialEnvironmentName];
  if (credential !== expectedCredential) {
    throw new Error("Deterministic provider credential mismatch");
  }
  return new MockLanguageModelV4({
    modelId: resolvedModel,
    doStream: async (options) => {
      console.info(JSON.stringify({
        event: "video.provider.selected",
        providerSentinel,
        requestedModelId: modelId,
        resolvedModelId: resolvedModel,
      }));
      if (JSON.stringify(options.prompt).includes("FORCE_PROVIDER_FAILURE")) {
        throw new Error("Forced provider failure", {
          cause: { providerCredential: credential, providerMetadata: providerMetadataSentinel },
        });
      }
      return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "stream-start",
            warnings: [{ type: "other", message: "Deterministic provider warning" }],
          });
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.enqueue({
            type: "text-delta",
            id: "text-1",
            delta: ${JSON.stringify("{\"type\":\"answer\",\"intent\":\"informational\",\"opening\":\"A video answer begins here.\",\"subject\":\"ocean waves\",\"development\":\"\",\"visualDirection\":\"Natural ocean footage.\",\"ending\":{\"narration\":\"Ocean waves carry energy toward the shore.\",\"title\":\"Waves carry energy\",\"subject\":\"ocean waves\",\"action\":\"Follow ocean waves moving toward the shore.\",\"durationSec\":5,\"continuity\":\"cut\"}}\n")},
          });
          controller.enqueue({ type: "text-end", id: "text-1" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
            providerMetadata: { test: { secret: providerMetadataSentinel } },
          });
          controller.close();
        },
      }),
      };
    },
  });
}
`;
}

function installDeterministicProviders(app) {
  writeFileSync(
    join(app, "src/app/api/video-chat/providers/openai.ts"),
    deterministicProviderSource("openai"),
  );
  writeFileSync(
    join(app, "src/app/api/video-chat/providers/anthropic.ts"),
    deterministicProviderSource("anthropic"),
  );
}

function compatibilityNativeSse(expectation) {
  const plan = "{\"type\":\"answer\",\"intent\":\"informational\",\"opening\":\"A video answer begins here.\",\"subject\":\"ocean waves\",\"development\":\"\",\"visualDirection\":\"Natural ocean footage.\",\"ending\":{\"narration\":\"Ocean waves carry energy toward the shore.\",\"title\":\"Waves carry energy\",\"subject\":\"ocean waves\",\"action\":\"Follow ocean waves moving toward the shore.\",\"durationSec\":5,\"continuity\":\"cut\"}}\n";
  if (expectation.provider === "google") {
    return [
      {
        responseId: "google-native-response",
        candidates: [{ content: { role: "model", parts: [{ text: plan }] } }],
      },
      {
        candidates: [{
          finishReason: "STOP",
          finishMessage: providerMetadataSentinel,
          safetyRatings: [],
        }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
          cachedContentTokenCount: 0,
          thoughtsTokenCount: 0,
        },
      },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  }
  return [
    {
      id: "openrouter-native-response",
      model: expectation.resolvedModel,
      provider: providerMetadataSentinel,
      choices: [{ index: 0, delta: { role: "assistant", content: plan }, finish_reason: null }],
    },
    {
      id: "openrouter-native-response",
      model: expectation.resolvedModel,
      provider: providerMetadataSentinel,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    },
  ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

function compatibilityProviderSource(expectation) {
  const providerImport = expectation.provider === "google"
    ? 'import { createGoogleGenerativeAI } from "@ai-sdk/google";'
    : 'import { createOpenRouter } from "@openrouter/ai-sdk-provider";';
  const factory = expectation.provider === "google"
    ? "createGoogleGenerativeAI"
    : "createOpenRouter";
  const expectedUrlFragment = expectation.provider === "google"
    ? `/models/${expectation.configuredModel}:streamGenerateContent?alt=sse`
    : "/chat/completions";
  const authorizationHeader = expectation.provider === "google"
    ? "x-goog-api-key"
    : "authorization";
  const expectedAuthorization = expectation.provider === "google"
    ? expectation.credential
    : `Bearer ${expectation.credential}`;
  const bodyModelCheck = expectation.provider === "openrouter"
    ? `if (body.model !== configuredModel) {
    throw new Error("Injected fetch received the wrong OpenRouter request model");
  }`
    : `if (body.model !== undefined) {
    throw new Error("Google request unexpectedly duplicated its URL model in the body");
  }`;
  return `import "server-only";
${providerImport}

const compatibilityProvider = ${JSON.stringify(expectation.provider)};
const configuredModel = ${JSON.stringify(expectation.configuredModel)};
const resolvedModel = ${JSON.stringify(expectation.resolvedModel)};
const providerSentinel = ${JSON.stringify(expectation.providerSentinel)};
const providerMetadataSentinel = ${JSON.stringify(providerMetadataSentinel)};
const syntheticCredential = ${JSON.stringify(expectation.credential)};
const nativeSse = ${JSON.stringify(compatibilityNativeSse(expectation))};
let fetchCount = 0;

const compatibilityFetch: typeof globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  fetchCount += 1;
  if (fetchCount !== 1) throw new Error("Provider made more than one native request");
  if (request.method !== "POST") throw new Error("Provider native request was not POST");
  if (!request.url.includes(${JSON.stringify(expectedUrlFragment)})) {
    throw new Error("Provider native request used an unexpected URL");
  }
  const authorization = request.headers.get(${JSON.stringify(authorizationHeader)});
  if (authorization !== ${JSON.stringify(expectedAuthorization)}) {
    throw new Error("Synthetic provider authorization did not reach injected fetch");
  }
  const requestText = await request.clone().text();
  if (request.url.includes(syntheticCredential) || requestText.includes(syntheticCredential)) {
    throw new Error("Synthetic provider authorization escaped its header");
  }
  const body = JSON.parse(requestText) as Record<string, unknown>;
  ${bodyModelCheck}
  console.info(JSON.stringify({
    event: "video.compatibility.fetch",
    provider: compatibilityProvider,
    fetchCount,
    method: request.method,
    requestModelId: configuredModel,
    authorizationVerified: true,
  }));
  return new Response(nativeSse, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const providerFactory = ${factory}({
  apiKey: syntheticCredential,
  fetch: compatibilityFetch,
  ${expectation.provider === "openrouter" ? 'compatibility: "strict",' : ""}
});
const nativeModel = providerFactory(configuredModel);
const nativeDoStream = nativeModel.doStream.bind(nativeModel);
const observedModel = new Proxy(nativeModel, {
  get(target, property, receiver) {
    if (property !== "doStream") return Reflect.get(target, property, receiver);
    return async (...args: Parameters<typeof nativeDoStream>) => {
      const result = await nativeDoStream(...args);
      const [applicationStream, metadataStream] = result.stream.tee();
      void (async () => {
        const reader = metadataStream.getReader();
        let providerMetadata: unknown;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (part.value.type === "finish") providerMetadata = part.value.providerMetadata;
        }
        const serializedMetadata = JSON.stringify(providerMetadata);
        console.info(JSON.stringify({
          event: "video.compatibility.metadata",
          provider: compatibilityProvider,
          private: providerMetadata !== undefined,
          sentinelMatched: serializedMetadata.includes(providerMetadataSentinel),
        }));
      })().catch(() => console.error(JSON.stringify({
        event: "video.compatibility.metadata_error",
        provider: compatibilityProvider,
      })));
      return { ...result, stream: applicationStream };
    };
  },
});

export function getVideoModel() {
  console.info(JSON.stringify({
    event: "video.compatibility.selected",
    provider: compatibilityProvider,
    providerSentinel,
    configuredModel,
    resolvedModel,
  }));
  return observedModel;
}
`;
}

async function waitForServer(server, url, output, acceptAnyResponse = false) {
  let lastReadinessDiagnostic = "no response";
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(url);
      lastReadinessDiagnostic = `HTTP ${response.status}`;
      if (response.ok || acceptAnyResponse) return;
    } catch (error) {
      lastReadinessDiagnostic = error instanceof Error ? error.message : String(error);
    }
    if (server.exitCode != null) throw new Error(`Next.js exited early:\n${output.value}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`Next.js did not serve ${url} (${lastReadinessDiagnostic}):\n${output.value}`);
}

async function start(app, args, port, environment, acceptAnyResponse = false) {
  const url = `http://127.0.0.1:${port}/`;
  const output = { value: "" };
  commandLog.push(`${app}$ npm ${args.join(" ")}`);
  const server = spawn("npm", args, {
    cwd: app,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnvironment(environment),
  });
  const capture = (chunk) => { output.value = `${output.value}${chunk}`.slice(-20_000); };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);
  try {
    await waitForServer(server, url, output, acceptAnyResponse);
  } catch (error) {
    await stopProcessTree(server);
    throw error;
  }
  return { server, output, url };
}

async function waitForOutput(output, pattern) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (pattern.test(output.value)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Server output did not match ${pattern}:\n${output.value}`);
}

function jsonEvents(output, event) {
  const events = [];
  for (const line of output.value.split("\n")) {
    const jsonStart = line.indexOf("{");
    if (jsonStart === -1) continue;
    try {
      const value = JSON.parse(line.slice(jsonStart));
      if (value?.event === event) events.push(value);
    } catch {
      // Next.js diagnostics are not lifecycle JSON.
    }
  }
  return events;
}

async function waitForJsonEvent(output, event, minimumCount = 1) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const events = jsonEvents(output, event);
    if (events.length >= minimumCount) return events.at(-1);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Server output did not contain ${minimumCount} ${event} event(s):\n${output.value}`);
}

async function waitForResponseBodies(responseBodies, minimumCount) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (responseBodies.length >= minimumCount) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Captured ${responseBodies.length} generation response bodies, expected ${minimumCount}`);
}

function assertCredentialSafe(valuesBySurface) {
  for (const [surface, value] of Object.entries(valuesBySurface)) {
    for (const forbidden of credentialForbiddenValues) {
      if (value.includes(forbidden.value)) {
        throw new Error(`${surface} contains server-only ${forbidden.label}`);
      }
    }
  }
}

function assertBrowserSafe(provider, valuesBySurface) {
  const expectation = providerExpectations[provider];
  const forbidden = [
    { label: "provider metadata sentinel", value: providerMetadataSentinel },
    { label: "provider selection sentinel", value: expectation.providerSentinel },
    { label: "configured model", value: expectation.configuredModel },
    { label: "resolved model", value: expectation.resolvedModel },
    { label: "provider metadata field", value: "providerMetadata" },
  ];
  assertCredentialSafe(valuesBySurface);
  for (const [surface, value] of Object.entries(valuesBySurface)) {
    for (const privateValue of forbidden) {
      if (value.includes(privateValue.value)) {
        throw new Error(`${provider} ${surface} contains server-only ${privateValue.label}`);
      }
    }
  }
}

function filesBelow(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...filesBelow(path));
    else files.push(path);
  }
  return files;
}

function verifyBrowserBoundary(app, provider) {
  const staticRoot = join(app, ".next/static");
  const staticSource = filesBelow(staticRoot)
    .filter((path) => /\.(?:js|map)$/.test(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const forbidden = [
    { label: "provider selection config", value: "VIDEO_PROVIDER" },
    { label: "model selection config", value: "VIDEO_MODEL" },
    { label: "provider metadata field", value: "providerMetadata" },
    { label: "provider metadata sentinel", value: providerMetadataSentinel },
    ...Object.values(providerExpectations).flatMap((expectation) => [
      { label: "provider selection sentinel", value: expectation.providerSentinel },
      { label: "configured model", value: expectation.configuredModel },
      { label: "resolved model", value: expectation.resolvedModel },
    ]),
  ];
  assertCredentialSafe({ "static bundle": staticSource });
  for (const privateValue of forbidden) {
    if (staticSource.includes(privateValue.value)) {
      throw new Error(`Browser bundle contains server-only ${privateValue.label}`);
    }
  }
  assertBrowserSafe(provider, { "static bundle": staticSource });
}

function assertCompatibilityBrowserSafe(expectation, valuesBySurface) {
  const forbidden = [
    { label: "provider metadata field", value: "providerMetadata" },
    { label: "provider metadata sentinel", value: providerMetadataSentinel },
    { label: "provider selection sentinel", value: expectation.providerSentinel },
    { label: "configured model", value: expectation.configuredModel },
    { label: "resolved model", value: expectation.resolvedModel },
  ];
  assertCredentialSafe(valuesBySurface);
  for (const [surface, value] of Object.entries(valuesBySurface)) {
    for (const privateValue of forbidden) {
      if (value.includes(privateValue.value)) {
        throw new Error(`${expectation.provider} ${surface} contains server-only ${privateValue.label}`);
      }
    }
  }
}

function verifyCompatibilityBrowserBoundary(app, expectation) {
  const staticRoot = join(app, ".next/static");
  const staticSource = filesBelow(staticRoot)
    .filter((path) => /\.(?:js|map)$/.test(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assertCompatibilityBrowserSafe(expectation, { "static bundle": staticSource });
}

function assertLockedPackage(lock, packageName, version, integrity, provider) {
  const entry = lock.packages?.[`node_modules/${packageName}`];
  if (entry?.version !== version || entry?.integrity !== integrity) {
    throw new Error(`${provider} locked ${packageName} as ${JSON.stringify(entry)}, expected ${version} ${integrity}`);
  }
}

async function verifyProvider({ provider, tarball, packed, browser }) {
  const expectation = providerExpectations[provider];
  const setupStarted = performance.now();
  const app = join(workspace, `nextjs-${provider}`);
  copyExample(app);
  if (hashFile(join(app, routeRelative)) !== routeHash) throw new Error(`${provider} route changed`);
  if (hashFile(join(app, clientRelative)) !== clientHash) throw new Error(`${provider} client changed`);
  if (hashFile(join(app, tsconfigRelative)) !== tsconfigHash) throw new Error(`${provider} TypeScript config changed`);

  const manifestPath = join(app, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.dependencies["@vanillaskyai/video"] = tarball;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  installDeterministicProviders(app);

  const environment = {
    VIDEO_PROVIDER: provider,
    VIDEO_MODEL: expectation.configuredModel,
    [credentialEnvironmentNames.openai]: fakeProviderCredentials.openai,
    [credentialEnvironmentNames.anthropic]: fakeProviderCredentials.anthropic,
  };
  const installStarted = performance.now();
  run("npm", ["install", "--no-audit", "--no-fund"], app, environment);
  const installTimeMs = Math.round(performance.now() - installStarted);
  const installedVersion = execFileSync(process.execPath, [
    "-p", "require('./node_modules/@vanillaskyai/video/package.json').version",
  ], { cwd: app, encoding: "utf8", env: childEnvironment(environment) }).trim();
  if (installedVersion !== packed.version) {
    throw new Error(`${provider} installed SDK ${installedVersion}, expected ${packed.version}`);
  }
  const lock = readFileSync(join(app, "package-lock.json"), "utf8");
  if (!lock.includes(packed.integrity)) {
    throw new Error(`${provider} package lock does not identify exact integrity ${packed.integrity}`);
  }

  const buildStarted = performance.now();
  run("npm", ["run", "build"], app, environment);
  const buildTimeMs = Math.round(performance.now() - buildStarted);
  verifyBrowserBoundary(app, provider);

  const productionPort = await allocateLocalPort();
  const production = await start(
    app,
    ["run", "start", "--", "-H", "127.0.0.1", "-p", String(productionPort)],
    productionPort,
    environment,
    true,
  );
  try {
    const response = await fetch(new URL("/api/video-chat?action=response", production.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.status !== 401) {
      const diagnostic = await response.json().catch(() => undefined);
      const code = typeof diagnostic?.error?.code === "string" ? ` (${diagnostic.error.code})` : "";
      throw new Error(`${provider} production auth returned ${response.status}${code}, expected 401`);
    }
  } finally {
    await stopProcessTree(production.server);
  }

  const firstVideoStarted = performance.now();
  const developmentPort = await allocateLocalPort();
  const development = await start(
    app,
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(developmentPort)],
    developmentPort,
    environment,
  );
  const page = await browser.newPage();
  const errors = [];
  const responseBodies = [];
  const responseCaptureErrors = [];
  const publicLifecycleEvidence = [];
  let generationPostCount = 0;
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/video-chat"
      && url.searchParams.get("action") === "response"
      && request.method() === "POST") {
      generationPostCount += 1;
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname !== "/api/video-chat"
      || url.searchParams.get("action") !== "response"
      || response.request().method() !== "POST") return;
    void response.text()
      .then((body) => { responseBodies.push(body); })
      .catch((error) => { responseCaptureErrors.push(error instanceof Error ? error.message : String(error)); });
  });
  try {
    await page.route("https://media.example/fixture.mp4", route => route.fulfill({
      contentType: "video/mp4",
      body: readFileSync(join(root, "tests/browser/fixtures/media-transition/waterfall.mp4")),
    }));
    await page.goto(development.url);
    await page.getByText("in video, not text.").waitFor();
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Activation increased from 41% to 58% after guided onboarding.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    try {
      await page.locator('[data-template-id="cinemaMedia"]').first().waitFor({ timeout: 10_000 });
    } catch (cause) {
      throw new Error(`Default video scene did not become visible: ${await page.locator("body").innerText()}; browser=${JSON.stringify(errors)}; response=${JSON.stringify(responseBodies)}`, { cause });
    }
    await waitForResponseBodies(responseBodies, 1);
    await waitForOutput(development.output, /"event":"video\.complete"/);
    const complete = await waitForJsonEvent(development.output, "video.complete");
    const warning = await waitForJsonEvent(development.output, "video.warning");
    publicLifecycleEvidence.push(complete, warning);
    if (JSON.stringify(complete.usage) !== JSON.stringify(expectedUsage)) {
      throw new Error(`${provider} normalized usage was ${JSON.stringify(complete.usage)}, expected ${JSON.stringify(expectedUsage)}`);
    }
    if (complete.requestedModelId !== expectation.resolvedModel
      || complete.resolvedModelId !== expectation.resolvedModel) {
      throw new Error(`${provider} lifecycle model IDs did not prove the selected adapter: ${JSON.stringify(complete)}`);
    }
    const selected = await waitForJsonEvent(development.output, "video.provider.selected");
    publicLifecycleEvidence.push(selected);
    if (selected.providerSentinel !== expectation.providerSentinel
      || selected.requestedModelId !== expectation.configuredModel
      || selected.resolvedModelId !== expectation.resolvedModel) {
      throw new Error(`${provider} selected ${JSON.stringify(selected.providerSentinel)}`);
    }
    const firstDom = await page.locator("body").innerText();
    assertBrowserSafe(provider, {
      "successful SSE": responseBodies[0],
      DOM: firstDom,
    });

    const postsBeforeReload = generationPostCount;
    await page.reload();
    await page.getByText("in video, not text.").waitFor();
    await page.waitForTimeout(250);
    if (generationPostCount !== postsBeforeReload) {
      throw new Error(`${provider} reload issued ${generationPostCount - postsBeforeReload} generation POST(s)`);
    }

    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("FORCE_PROVIDER_FAILURE");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.getByRole("status").waitFor({ timeout: 15_000 });
    const errorEvent = await waitForJsonEvent(development.output, "video.error");
    publicLifecycleEvidence.push(errorEvent);
    await waitForResponseBodies(responseBodies, 2);
    if (generationPostCount !== postsBeforeReload + 1) {
      throw new Error(`${provider} forced cinematic failure issued ${generationPostCount - postsBeforeReload} generation POST(s), expected one without automatic resubmission`);
    }
    const failedDom = await page.locator("body").innerText();
    assertBrowserSafe(provider, {
      "all SSE": responseBodies.join("\n"),
      DOM: failedDom,
    });
    if (responseCaptureErrors.length) {
      throw new Error(`${provider} response capture errors: ${responseCaptureErrors.join(" | ")}`);
    }
    if (errors.length) throw new Error(`${provider} browser errors: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await stopProcessTree(development.server);
  }
  const firstVideoTimeMs = Math.round(performance.now() - firstVideoStarted);
  const setupTimeMs = Math.round(performance.now() - setupStarted);
  if (setupTimeMs >= 15 * 60 * 1000) {
    throw new Error(`${provider} clean-room setup exceeded 15 minutes: ${setupTimeMs}ms`);
  }
  if (hashFile(join(app, routeRelative)) !== routeHash) throw new Error(`${provider} route drifted`);
  if (hashFile(join(app, clientRelative)) !== clientHash) throw new Error(`${provider} client drifted`);
  if (hashFile(join(app, tsconfigRelative)) !== tsconfigHash) throw new Error(`${provider} build rewrote TypeScript config`);
  const publicEvidence = {
    provider,
    version: packed.version,
    integrity: packed.integrity,
    installTimeMs,
    buildTimeMs,
    firstVideoTimeMs,
    setupTimeMs,
    productionAuthStatus: 401,
    warning: "provider_warning",
    usage: expectedUsage,
    configuredModel: expectation.configuredModel,
    resolvedModel: expectation.resolvedModel,
    providerSelection: "verified server-side and absent from browser surfaces",
    forcedFailure: "generation_failed + video.error; no automatic cinematic resubmission",
    playback: "default video chat",
    reload: "returns to welcome without a response request",
    browserBoundary: "SSE + DOM + static bundle",
    credentialBoundary: "fake provider credentials consumed server-side and absent from public evidence",
  };
  assertCredentialSafe({
    "production server log": production.output.value,
    "public lifecycle evidence": JSON.stringify(publicLifecycleEvidence),
    "retained provider evidence": JSON.stringify(publicEvidence),
    "retained command log": commandLog.join("\n"),
  });
  console.log(JSON.stringify(publicEvidence));
  return publicEvidence;
}

async function verifyCompatibilityProvider({ expectation, tarball, packed, browser }) {
  const { provider } = expectation;
  if (expectation.fixtureOnly !== true) {
    throw new Error(`${provider} compatibility must remain fixture-only`);
  }
  const setupStarted = performance.now();
  const app = join(workspace, `nextjs-compatibility-${provider}`);
  copyExample(app);
  if (hashFile(join(app, routeRelative)) !== routeHash) throw new Error(`${provider} route changed`);
  if (hashFile(join(app, plannerRelative)) !== plannerHash) throw new Error(`${provider} planner changed`);
  if (hashFile(join(app, clientRelative)) !== clientHash) throw new Error(`${provider} client changed`);
  if (hashFile(join(app, tsconfigRelative)) !== tsconfigHash) throw new Error(`${provider} TypeScript config changed`);

  const manifestPath = join(app, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  delete manifest.dependencies["@ai-sdk/openai"];
  delete manifest.dependencies["@ai-sdk/anthropic"];
  manifest.dependencies["@vanillaskyai/video"] = tarball;
  manifest.dependencies.ai = aiVersion;
  manifest.dependencies[expectation.packageName] = expectation.version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(join(app, "src/app/api/video-chat/providers"), { recursive: true });
  writeFileSync(
    join(app, "src/app/api/video-chat/provider.ts"),
    compatibilityProviderSource(expectation),
  );

  const installStarted = performance.now();
  run("npm", ["install", "--no-audit", "--no-fund"], app);
  const installTimeMs = Math.round(performance.now() - installStarted);
  const installedVersion = execFileSync(process.execPath, [
    "-p", "require('./node_modules/@vanillaskyai/video/package.json').version",
  ], { cwd: app, encoding: "utf8", env: childEnvironment() }).trim();
  if (installedVersion !== packed.version) {
    throw new Error(`${provider} installed SDK ${installedVersion}, expected ${packed.version}`);
  }
  const lock = JSON.parse(readFileSync(join(app, "package-lock.json"), "utf8"));
  assertLockedPackage(lock, expectation.packageName, expectation.version, expectation.integrity, provider);
  assertLockedPackage(lock, "ai", aiVersion, aiIntegrity, provider);
  if (lock.packages?.["node_modules/@vanillaskyai/video"]?.integrity !== packed.integrity) {
    throw new Error(`${provider} package lock does not identify exact SDK integrity ${packed.integrity}`);
  }

  const buildStarted = performance.now();
  run("npm", ["run", "build"], app);
  const buildTimeMs = Math.round(performance.now() - buildStarted);
  verifyCompatibilityBrowserBoundary(app, expectation);

  const productionPort = await allocateLocalPort();
  const production = await start(
    app,
    ["run", "start", "--", "-H", "127.0.0.1", "-p", String(productionPort)],
    productionPort,
    {},
    true,
  );
  try {
    const response = await fetch(new URL("/api/video-chat?action=response", production.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.status !== 401) {
      throw new Error(`${provider} production auth returned ${response.status}, expected 401`);
    }
    if (jsonEvents(production.output, "video.compatibility.fetch").length !== 0) {
      throw new Error(`${provider} production authorization failure reached provider fetch`);
    }
  } finally {
    await stopProcessTree(production.server);
  }

  const firstVideoStarted = performance.now();
  const developmentPort = await allocateLocalPort();
  const development = await start(
    app,
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(developmentPort)],
    developmentPort,
    {},
  );
  const page = await browser.newPage();
  const errors = [];
  const responseBodies = [];
  const responseCaptureErrors = [];
  const serverLifecycleEvidence = [];
  let generationPostCount = 0;
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/video-chat"
      && url.searchParams.get("action") === "response"
      && request.method() === "POST") {
      generationPostCount += 1;
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname !== "/api/video-chat"
      || url.searchParams.get("action") !== "response"
      || response.request().method() !== "POST") return;
    void response.text()
      .then((body) => { responseBodies.push(body); })
      .catch((error) => { responseCaptureErrors.push(error instanceof Error ? error.message : String(error)); });
  });
  try {
    await page.route("https://media.example/fixture.mp4", route => route.fulfill({
      contentType: "video/mp4",
      body: readFileSync(join(root, "tests/browser/fixtures/media-transition/waterfall.mp4")),
    }));
    await page.goto(development.url);
    await page.getByText("in video, not text.").waitFor();
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Activation increased from 41% to 58% after guided onboarding.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.locator('[data-template-id="cinemaMedia"]').first().waitFor({ timeout: 10_000 });
    await waitForResponseBodies(responseBodies, 1);

    const complete = await waitForJsonEvent(development.output, "video.complete");
    const fetchEvent = await waitForJsonEvent(development.output, "video.compatibility.fetch");
    const metadata = await waitForJsonEvent(development.output, "video.compatibility.metadata");
    const selected = await waitForJsonEvent(development.output, "video.compatibility.selected");
    serverLifecycleEvidence.push(complete, fetchEvent, metadata, selected);
    if (complete.finishReason !== "stop") {
      throw new Error(`${provider} finish reason was ${JSON.stringify(complete.finishReason)}, expected stop`);
    }
    if (JSON.stringify(complete.usage) !== JSON.stringify(expectedCompatibilityUsage)) {
      throw new Error(`${provider} normalized usage was ${JSON.stringify(complete.usage)}, expected ${JSON.stringify(expectedCompatibilityUsage)}`);
    }
    if (complete.requestedModelId !== expectation.configuredModel
      || complete.resolvedModelId !== expectation.resolvedModel) {
      throw new Error(`${provider} lifecycle model IDs were incorrect: ${JSON.stringify(complete)}`);
    }
    if (fetchEvent.fetchCount !== 1
      || fetchEvent.authorizationVerified !== true
      || fetchEvent.requestModelId !== expectation.configuredModel) {
      throw new Error(`${provider} injected fetch evidence was incorrect: ${JSON.stringify(fetchEvent)}`);
    }
    if (metadata.private !== true || metadata.sentinelMatched !== true) {
      throw new Error(`${provider} server metadata evidence was incorrect: ${JSON.stringify(metadata)}`);
    }
    if (selected.providerSentinel !== expectation.providerSentinel
      || selected.configuredModel !== expectation.configuredModel
      || selected.resolvedModel !== expectation.resolvedModel) {
      throw new Error(`${provider} selected provider evidence was incorrect: ${JSON.stringify(selected)}`);
    }
    if (jsonEvents(development.output, "video.compatibility.fetch").length !== 1) {
      throw new Error(`${provider} native fetch count was not exactly one`);
    }
    if (generationPostCount !== 1) {
      throw new Error(`${provider} browser issued ${generationPostCount} generation POST(s), expected one`);
    }

    const firstDom = await page.locator("body").innerText();
    assertCompatibilityBrowserSafe(expectation, {
      "successful SSE": responseBodies[0],
      DOM: firstDom,
    });

    const postsBeforeReload = generationPostCount;
    const fetchesBeforeReload = jsonEvents(development.output, "video.compatibility.fetch").length;
    await page.reload();
    await page.getByText("in video, not text.").waitFor();
    await page.waitForTimeout(250);
    if (generationPostCount !== postsBeforeReload) {
      throw new Error(`${provider} reload issued ${generationPostCount - postsBeforeReload} generation POST(s)`);
    }
    if (jsonEvents(development.output, "video.compatibility.fetch").length !== fetchesBeforeReload) {
      throw new Error(`${provider} reload issued a native provider request`);
    }
    const reloadedDom = await page.locator("body").innerText();
    assertCompatibilityBrowserSafe(expectation, {
      "all SSE": responseBodies.join("\n"),
      DOM: reloadedDom,
    });
    if (responseCaptureErrors.length) {
      throw new Error(`${provider} response capture errors: ${responseCaptureErrors.join(" | ")}`);
    }
    if (errors.length) throw new Error(`${provider} browser errors: ${errors.join(" | ")}`);
  } finally {
    await page.close();
    await stopProcessTree(development.server);
  }

  const firstVideoTimeMs = Math.round(performance.now() - firstVideoStarted);
  const setupTimeMs = Math.round(performance.now() - setupStarted);
  if (setupTimeMs >= 15 * 60 * 1000) {
    throw new Error(`${provider} compatibility setup exceeded 15 minutes: ${setupTimeMs}ms`);
  }
  if (hashFile(join(app, routeRelative)) !== routeHash) throw new Error(`${provider} route drifted`);
  if (hashFile(join(app, plannerRelative)) !== plannerHash) throw new Error(`${provider} planner drifted`);
  if (hashFile(join(app, clientRelative)) !== clientHash) throw new Error(`${provider} client drifted`);
  if (hashFile(join(app, tsconfigRelative)) !== tsconfigHash) throw new Error(`${provider} TypeScript config drifted`);
  const publicEvidence = {
    provider,
    mode: "fixture-only",
    providerPackage: {
      name: expectation.packageName,
      version: expectation.version,
      integrity: expectation.integrity,
    },
    aiPackage: { version: aiVersion, integrity: aiIntegrity },
    sdkPackage: { version: packed.version, integrity: packed.integrity },
    installTimeMs,
    buildTimeMs,
    firstVideoTimeMs,
    setupTimeMs,
    productionAuthStatus: 401,
    finishReason: "stop",
    usage: expectedCompatibilityUsage,
    configuredModel: expectation.configuredModel,
    resolvedModel: expectation.resolvedModel,
    nativeFetchCount: 1,
    providerMetadata: "observed server-side and absent from browser surfaces",
    reload: "returns to welcome without a response request",
    browserBoundary: "SSE + DOM + static bundle",
  };
  assertCredentialSafe({
    "production server log": production.output.value,
    "public lifecycle evidence": JSON.stringify(serverLifecycleEvidence),
    "retained compatibility evidence": JSON.stringify(publicEvidence),
    "retained command log": commandLog.join("\n"),
  });
  console.log(JSON.stringify(publicEvidence));
  return publicEvidence;
}

let browser;
try {
  const selectedArtifact = selectPackedArtifact({
    providedPath: process.env.VANILLASKY_PACKED_TARBALL
      ? resolve(process.env.VANILLASKY_PACKED_TARBALL)
      : undefined,
    expectedIntegrity: process.env.VANILLASKY_EXPECTED_INTEGRITY,
    expectedSha256: process.env.VANILLASKY_EXPECTED_SHA256,
    packArtifact: () => {
      run("npm", ["run", "build"], root);
      const [packed] = parseNpmPackJson(execFileSync("npm", [
        "pack", "--silent", "--json", "--ignore-scripts", "--pack-destination", workspace,
      ], { cwd: root, encoding: "utf8", env: childEnvironment() }));
      return { path: join(workspace, packed.filename), integrity: packed.integrity };
    },
  });
  const packageManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const packed = {
    version: packageManifest.version,
    integrity: selectedArtifact.integrity,
    sha256: selectedArtifact.sha256,
  };
  const tarball = selectedArtifact.path;
  const publicEvidence = {
    artifact: basename(tarball),
    version: packed.version,
    integrity: packed.integrity,
    sha256: packed.sha256,
  };
  assertCredentialSafe({ "retained artifact evidence": JSON.stringify(publicEvidence) });
  console.log(JSON.stringify(publicEvidence));

  browser = await chromium.launch();
  for (const provider of selectedProviders) {
    retainedProviderEvidence.push(await verifyProvider({ provider, tarball, packed, browser }));
  }
  for (const expectation of selectedCompatibilityProviders) {
    retainedProviderEvidence.push(await verifyCompatibilityProvider({ expectation, tarball, packed, browser }));
  }
  const providerEvidencePath = process.env.VANILLASKY_PROVIDER_EVIDENCE_PATH;
  if (providerEvidencePath) {
    const candidateCommit = process.env.VANILLASKY_CANDIDATE_COMMIT;
    if (!/^[a-f0-9]{40}$/.test(candidateCommit ?? "")) {
      throw new Error("Retained provider evidence requires the exact candidate commit");
    }
    if (basename(providerEvidencePath) !== providerEvidenceFilename) {
      throw new Error(`Retained provider evidence must be named ${providerEvidenceFilename}`);
    }
    const retained = {
      schemaVersion: 1,
      candidate: {
        commit: candidateCommit,
        version: packed.version,
        integrity: packed.integrity,
        sha256: packed.sha256,
      },
      providers: retainedProviderEvidence,
    };
    assertCredentialSafe({ "retained provider evidence": JSON.stringify(retained) });
    writeFileSync(providerEvidencePath, `${JSON.stringify(retained, null, 2)}\n`);
  }
  const checkedProviders = retainedProviderEvidence.map(({ provider }) => provider).join(", ");
  console.log(`${checkedProviders} passed the exact packed Next.js gate with the canonical route, planner, and client.`);
} finally {
  if (browser) await browser.close();
  try {
    const publicEvidence = `Next.js provider onboarding command log:\n${commandLog.join("\n")}`;
    assertCredentialSafe({ "retained final command evidence": publicEvidence });
    console.log(publicEvidence);
  } finally {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
