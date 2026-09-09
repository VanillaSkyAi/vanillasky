import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Spread neighboring parameterized media cases across runners. Playwright's
// default contiguous shards concentrate the slow narration cases on runner 1.
export function selectBrowserShard(list, current, total) {
  if (!Number.isInteger(total) || !Number.isInteger(current) || current < 1 || current > total) throw new Error("Invalid browser shard");
  const tests = list.split("\n").map(line => line.trim()).filter(line => /^\[[^\]]+\] › /.test(line));
  if (!tests.length || new Set(tests).size !== tests.length) throw new Error("Empty or ambiguous browser test list");
  const selected = tests.filter((_, index) => index % total === current - 1);
  if (!selected.length) throw new Error("Empty browser shard");
  return selected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [browser, shard] = process.argv.slice(2);
  if (!["chromium", "firefox", "webkit"].includes(browser)) throw new Error("Invalid browser");
  const [current, total] = (shard ?? "").split("/").map(Number);
  const cli = resolve("node_modules/playwright/cli.js");
  const env = { ...process.env, FORCE_COLOR: "0" };
  const list = execFileSync(process.execPath, [cli, "test", `--project=${browser}`, "--list", "--reporter=list"], { encoding: "utf8", env });
  const selected = selectBrowserShard(list, current, total);
  mkdirSync(".generated", { recursive: true });
  const path = `.generated/browser-${browser}-${current}.txt`;
  writeFileSync(path, selected.join("\n") + "\n");
  console.log(`Running ${selected.length} ${browser} tests in group ${current}/${total}`);
  // The list already partitions every test; a second --shard would omit tests.
  const result = spawnSync(process.execPath, [cli, "test", `--project=${browser}`, `--test-list=${path}`, "--workers=1"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
