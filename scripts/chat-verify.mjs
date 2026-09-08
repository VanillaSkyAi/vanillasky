#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const run = (command, args, env = process.env) => execFileSync(command, args, {stdio: "inherit", env});
for (const gate of ["lint", "typecheck", "test", "acceptance:chat"]) run("npm", ["run", gate]);
run("npx", ["tsc", "--noEmit", "--project", "dev/chat/tsconfig.json"]);
run(process.execPath, ["scripts/chat-candidate.mjs"]);
const directory = resolve(process.env.VANILLASKY_CANDIDATE_DIR ?? "artifacts/chat-candidate");
const candidate = JSON.parse(readFileSync(resolve(directory, "candidate.json"), "utf8"));
const env = {...process.env, VANILLASKY_PACKED_TARBALL: resolve(directory, candidate.filename), VANILLASKY_EXPECTED_INTEGRITY: candidate.integrity, VANILLASKY_EXPECTED_SHA256: candidate.sha256};
delete env.VANILLASKY_INSTALL_SPEC;
delete env.VANILLASKY_PROVIDER;
run("npm", ["run", "verify:package-size"], env);
run("npm", ["audit", "--audit-level=low", "--omit=dev"], env);
for (const file of ["verify-packed-package.mjs", "verify-onboarding.mjs", "verify-nextjs-onboarding.mjs"]) run(process.execPath, [`scripts/${file}`], env);
run("npx", ["playwright", "test", "--workers=1"], env);
run("npx", ["playwright", "test", "--config", "dev/chat/playwright.config.ts"], env);
console.log(`Release verification passed against one candidate: ${candidate.integrity}. No publishing or deployment performed.`);
