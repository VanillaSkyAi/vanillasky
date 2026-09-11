import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnipConfig } from "knip";

// Playwright navigates to HTML fixtures instead of importing their modules.
const fixtures = "tests/browser/fixtures";
const fixtureEntries = readdirSync(fixtures).filter(file => file.endsWith(".html")).flatMap(file =>
  [...readFileSync(join(fixtures, file), "utf8").matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)]
    .map(([, source]) => source.startsWith("/") ? source.slice(1) : join(fixtures, source)),
);

export default {
  entry: [
    // Internal integration boundaries documented for application customization.
    "src/react.ts", "src/server.ts",
    // Cloudflare Pages discovers route handlers by filename.
    "functions/api/**/*.mjs", "functions/owner.mjs",
    ...fixtureEntries,
    "tests/browser/fixtures.config.ts",
    // Invoked by release tooling and the documented fixture regeneration command.
    "scripts/verify-app-deployment.mjs", "tests/support/chat/speech/generate.mjs",
  ],
  playwright: { config: ["playwright.config.ts", "app.playwright.config.ts"] },
} satisfies KnipConfig;
