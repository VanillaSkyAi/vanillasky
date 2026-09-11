import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { WELCOME_CARDS } from "../../src/video-chat/welcome-cards.js";
import type { VideoOrientation } from "../../src/protocol/types.js";
import { createAppIdentity } from "../deployment-app-identity.mjs";
import { AnswerRecorder } from "./record.js";
import { clear, publish, type PublishTarget } from "./publish.js";

/**
 * Owner tooling for the recorded answer cache.
 *
 *   tsx scripts/answer-cache/run.ts warm [--prompts "…" …] [--orientation landscape|portrait|both] [--depth 0|1] [--max-suggestions 3]
 *   tsx scripts/answer-cache/run.ts publish --local|--remote
 *   tsx scripts/answer-cache/run.ts clear --local|--remote
 *
 * `warm` needs `npm run dev` running with real provider keys in `.dev.vars`;
 * the recordings land in `.generated/answer-cache/`. `publish --local` loads them
 * into the development bucket for review in the app; `--remote` uploads to the
 * bucket named by `CLOUDFLARE_ANSWER_CACHE_BUCKET`.
 */
const EXPORT_DIR = resolve(".generated/answer-cache");
const log = (message: string) => console.log(message);

function target(remote: boolean): PublishTarget {
  if (remote) {
    const bucket = process.env.CLOUDFLARE_ANSWER_CACHE_BUCKET?.trim();
    if (!bucket) throw new Error("Set CLOUDFLARE_ANSWER_CACHE_BUCKET to the production bucket name");
    return { bucket, remote: true };
  }
  const config = JSON.parse(readFileSync(resolve("wrangler.jsonc"), "utf8")) as { r2_buckets?: { binding: string; bucket_name: string }[] };
  const bucket = config.r2_buckets?.find((entry) => entry.binding === "VIDEO_CHAT_ANSWER_CACHE")?.bucket_name;
  if (!bucket) throw new Error("wrangler.jsonc has no VIDEO_CHAT_ANSWER_CACHE bucket");
  return { bucket, remote: false };
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    prompts: { type: "string", multiple: true },
    orientation: { type: "string", default: "landscape" },
    depth: { type: "string", default: "1" },
    "max-suggestions": { type: "string", default: "3" },
    attempts: { type: "string", default: "3" },
    api: { type: "string", default: `http://127.0.0.1:${process.env.APP_API_PORT ?? 8788}` },
    local: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});
const command = positionals[0];

if (command === "warm") {
  const orientations: VideoOrientation[] = values.orientation === "both" ? ["landscape", "portrait"]
    : values.orientation === "portrait" ? ["portrait"] : ["landscape"];
  const depth = values.depth === "0" ? 0 : 1;
  const recorder = new AnswerRecorder({
    api: values.api, exportDir: EXPORT_DIR, commit: createAppIdentity().commit, depth,
    maxSuggestions: Number(values["max-suggestions"]), attempts: Number(values.attempts), log,
  });
  const prompts = values.prompts?.length ? values.prompts : WELCOME_CARDS.map((card) => card.prompt);
  for (const orientation of orientations) {
    for (const prompt of prompts) await recorder.record({ prompt, orientation, conversation: [] });
  }
  log(`recordings are in ${EXPORT_DIR}`);
} else if (command === "publish" || command === "clear") {
  if (values.local === values.remote) throw new Error("Choose exactly one of --local or --remote");
  if (!existsSync(EXPORT_DIR)) throw new Error(`Nothing exported at ${EXPORT_DIR}; run warm first`);
  const keys = (command === "publish" ? publish : clear)(EXPORT_DIR, target(values.remote), log);
  log(`${command === "publish" ? "published" : "removed"} ${keys.length} objects`);
} else {
  throw new Error("Usage: run.ts warm | publish --local|--remote | clear --local|--remote");
}
