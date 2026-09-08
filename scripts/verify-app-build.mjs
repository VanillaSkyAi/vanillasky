import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { assertAppIdentity, assertAppMarkup, createAppIdentity } from "./deployment-app-identity.mjs";

import { assertBuiltHostingPolicy } from "./deployment-hosting-policy.mjs";

assertBuiltHostingPolicy();
const built = assertAppIdentity(JSON.parse(readFileSync("dist/app-build.json", "utf8")));
if (JSON.stringify(built) !== JSON.stringify(createAppIdentity())) throw new Error("Checkout changed after application build");
assertAppMarkup(readFileSync("dist/index.html", "utf8"), built);
function digestDirectory(directory) {
  const records = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) records.push(...digestDirectory(path));
    else records.push({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
  }
  return records;
}
const files = [...digestDirectory("dist"), ...digestDirectory(".generated/functions-build")];
const artifactPath = ".generated/app-artifact.json";
const artifact = { ...built, files };
if (process.argv.includes("--check")) {
  if (JSON.stringify(JSON.parse(readFileSync(artifactPath, "utf8"))) !== JSON.stringify(artifact)) {
    throw new Error("Downloaded application differs from the verified CI artifact");
  }
} else {
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
}
console.log(`Verified app build ${built.commit}; ${files.length} output files`);
