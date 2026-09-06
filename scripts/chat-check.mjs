#!/usr/bin/env node
import { execFileSync } from "node:child_process";
const started = performance.now();
const run = (command, args) => execFileSync(command, args, {stdio: "inherit"});
run("npx", ["vitest", "run", "tests/chat-development.test.ts", "tests/chat-diagnostics.test.ts", "tests/scene-video-hold.test.tsx", "tests/media-chapter-recovery.test.tsx", "tests/mounted-scene-readiness.test.tsx"]);
run("npx", ["tsc", "--noEmit", "--project", "dev/chat/tsconfig.json"]);
run("npx", ["playwright", "test", "tests/browser/continuous-video.spec.ts", "--project=chromium", "--workers=1", "-g", ": short$"]);
run("npx", ["playwright", "test", "--config", "dev/chat/playwright.config.ts"]);
console.log(`Focused chat checks passed in ${((performance.now() - started) / 1000).toFixed(1)}s. Fixture evidence only; full release gates are separate.`);
