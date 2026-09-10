// POC only: answer from a product's own documentation, using its real screenshots
// for anything the answer claims about the product. Text-to-video cannot draw a
// true UI, so the shots have to come from the docs; generated footage stays for
// the beats that are about ideas rather than screens.
import { pocDocs } from "./poc-docs-data.mjs";

export const pocDocsEnabled = (env) => env?.POC_DOCS === "enabled";

const screenshots = pocDocs.articles.flatMap((article) =>
  article.blocks.flatMap((block, index) => {
    if (block.type !== "image" || !block.url) return [];
    // The step immediately above a screenshot is what it illustrates.
    const step = [...article.blocks.slice(0, index)].reverse()
      .find((candidate) => candidate.type === "step" || candidate.type === "text");
    return [{
      id: `${article.slug}-${article.blocks.slice(0, index).filter((b) => b.type === "image").length + 1}`,
      url: block.url,
      alt: block.alt,
      step: step?.text ?? "",
      article: article.title,
    }];
  }));

const REFERENCE = /^screenshot:([a-z0-9-]+)$/i;
const WORDS = /[\p{L}\p{N}]+/gu;
const STOP = new Set(["the","a","an","of","to","and","in","on","for","with","your","you","is","are","that","this","it","at","by","from","or","screenshot","github"]);
const terms = (value) => (String(value ?? "").toLowerCase().match(WORDS) ?? []).filter((word) => !STOP.has(word));

/** Compact catalogue the planner picks from by id. */
export function pocDocsInstructions() {
  const shots = screenshots
    .map((shot) => `- screenshot:${shot.id} — ${shot.alt || shot.step}`)
    .join("\n");
  const steps = pocDocs.articles
    .map((article) => {
      const body = article.blocks
        .filter((block) => block.type !== "image")
        .map((block) => block.text)
        .join(" ")
        .slice(0, 1800);
      return `## ${article.title}\n${body}`;
    })
    .join("\n\n");
  return [
    `You are answering questions about ${pocDocs.product} using its official documentation below.`,
    "Answer only from this documentation. If it does not cover the question, say so in the narration instead of inventing steps.",
    "",
    "Every scene that shows or claims something about the product interface must use a documentation screenshot:",
    "search for media with the exact query `screenshot:<id>` from this catalogue, and narrate the step it illustrates.",
    "Scenes about concepts, motivation or outcomes may use ordinary footage.",
    "",
    "Screenshots:",
    shots,
    "",
    "Documentation:",
    steps,
  ].join("\n");
}

const asText = (query) => typeof query === "string"
  ? query
  : [query?.subject, query?.activity, query?.equipment].filter(Boolean).join(" ");

/**
 * Exact id first; a scored fallback keeps a near-miss on a real shot instead of
 * dropping to stock. The origin is required: chat media must be an absolute URL.
 */
export function matchPocScreenshot(query, origin) {
  const text = asText(query).trim();
  const reference = REFERENCE.exec(text);
  if (reference) {
    const exact = screenshots.find((shot) => shot.id.toLowerCase() === reference[1].toLowerCase());
    if (exact) return media(exact, origin);
  }
  const wanted = terms(text);
  if (!wanted.length) return null;
  let best = null;
  let bestScore = 0;
  for (const shot of screenshots) {
    const haystack = new Set(terms(`${shot.alt} ${shot.step} ${shot.article}`));
    const score = wanted.filter((word) => haystack.has(word)).length / wanted.length;
    if (score > bestScore) { bestScore = score; best = shot; }
  }
  return bestScore >= 0.5 && best ? media(best, origin) : null;
}

const media = (shot, origin) => ({
  url: new URL(shot.url, origin).href,
  type: "image",
  description: shot.alt || shot.step,
});

export const pocScreenshotCount = screenshots.length;
