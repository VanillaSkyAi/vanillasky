import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertAppIdentity, assertAppMarkup } from "./deployment-app-identity.mjs";

const url = new URL(process.env.DEPLOYMENT_URL);
if (url.protocol !== "https:") throw new Error("Deployment verification requires HTTPS");
const expected = assertAppIdentity(JSON.parse(readFileSync("dist/app-build.json", "utf8")));
const artifact = JSON.parse(readFileSync(".generated/app-artifact.json", "utf8"));
if (artifact.commit !== expected.commit || artifact.sourceSha256 !== expected.sourceSha256) throw new Error("Deployment artifact is stale");
let lastError;
for (let attempt = 0; attempt < 24; attempt++) {
  try {
    const [page, health, status] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "cache-control": "no-cache" } }),
      fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(15_000), headers: { "cache-control": "no-cache" } }),
      fetch(new URL("/api/video-chat?action=status", url), { signal: AbortSignal.timeout(15_000), headers: { "cache-control": "no-cache" } }),
    ]);
    if (!page.ok || !health.ok || !status.ok) throw new Error(`Deployment returned ${page.status}/${health.status}/${status.status}`);
    assertAppMarkup(await page.text(), expected);
    const observed = await health.json();
    if (observed.commit !== expected.commit || observed.sourceSha256 !== expected.sourceSha256) {
      throw new Error("Deployed API and frontend identities differ");
    }
    const capabilities = await status.json();
    if (process.env.DEPLOYMENT_TARGET === "preview" && (capabilities.ready !== false || !capabilities.missing?.includes("VIDEO_CHAT_PAID_PROVIDERS"))) {
      throw new Error("Preview must disable all paid provider calls");
    }
    if (process.env.DEPLOYMENT_TARGET === "production" && capabilities.ready !== true) {
      throw new Error("Production application configuration is incomplete");
    }
    for (const file of artifact.files.filter((file) => /^dist\/.*\.(js|css)$/.test(file.path))) {
      const asset = await fetch(new URL(file.path.slice("dist/".length), url), { signal: AbortSignal.timeout(15_000) });
      if (!asset.ok || createHash("sha256").update(Buffer.from(await asset.arrayBuffer())).digest("hex") !== file.sha256) {
        throw new Error(`Deployed asset differs from verified output: ${file.path}`);
      }
    }
    console.log(`Verified frontend and API at ${url.origin}: ${expected.commit} (${expected.sourceSha256})`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
throw lastError;
