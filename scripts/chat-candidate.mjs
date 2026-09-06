#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseNpmPackJson } from "./lib/parse-npm-pack-json.mjs";
import { assertFileHashes, calculateFileSha256 } from "./lib/release-integrity.mjs";
const directory = resolve(process.env.VANILLASKY_CANDIDATE_DIR ?? "artifacts/chat-candidate");
mkdirSync(directory, {recursive: true});
execFileSync("npm", ["run", "build"], {stdio: "inherit"});
const [packed] = parseNpmPackJson(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", directory], {encoding: "utf8"}));
const tarball = resolve(directory, "package.tgz");
copyFileSync(resolve(directory, packed.filename), tarball);
const sha256 = calculateFileSha256(tarball);
assertFileHashes(tarball, {sha512: packed.integrity, sha256});
const candidate = {version: packed.version, filename: "package.tgz", integrity: packed.integrity, sha256,
  commit: execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(),
  dirty: Boolean(execFileSync("git", ["status", "--porcelain"], {encoding: "utf8"}).trim())};
writeFileSync(resolve(directory, "candidate.json"), JSON.stringify(candidate, null, 2) + "\n");
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `integrity=${candidate.integrity}\nsha256=${sha256}\n`, {flag: "a"});
console.log(`Candidate ${candidate.version}: ${tarball}\n${candidate.integrity}\nSource ${candidate.commit}${candidate.dirty ? " (uncommitted changes)" : ""}`);
