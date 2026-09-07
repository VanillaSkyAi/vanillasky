import type { VideoScene } from "../protocol/types.js";

/** One finite creative plan. Technical composition stays runtime-owned. */
export function createVideoChatResponseInstructions(
  generatedVideoAvailable: boolean,
  openingAlreadyProvided = false,
  maxGeneratedVideos = 5,
  clipDurationSec = 5,
  mode: "cinematic" | "pexels" = "cinematic",
): string {
 return [
  "Write a complete, intentful video answer as newline-delimited JSON. Match the user's form and tone; mixed intents can combine directions.",
  `First write one brief: {"type":"answer","intent":"explanation|story|comedy|imagination|practical","opening":"a short inviting spoken introduction of 6–9 words","subject":"literal visual subject","development":"the essential development of this answer","visualDirection":"consistent subjects, appearance and visual approach","ending":{"title":"short meaningful chapter title, at most 65 characters","narration":"the authored payoff","subject":"literal subject","action":"visible action or change","durationSec":${clipDurationSec},"continuity":"cut|continue"}}.`,
  `Then stream each developing shot on its own line: {"type":"shot","title":"short meaningful chapter title, at most 65 characters","narration":"the exact spoken beat","subject":"2–8 literal filmable words, at most 80 characters","action":"concrete subject, action or visible change and useful framing","durationSec":${clipDurationSec},"continuity":"cut|continue"}.`,
  `The selected footage mode is ${mode === "pexels" ? "Pexels stock search: use literal filmable subjects; never imply stock proves a mechanism or depicts fictional events exactly" : `AI video, with at most ${generatedVideoAvailable ? maxGeneratedVideos : 0} generation attempts`}. Missing footage becomes the authored chapter title, with complete narration. Preserve the full answer rather than shortening it to fit credits. The host selects providers; do not make source choices.`,
  ...(mode === "pexels" ? ["Stock queries must retain the essential subject, activity and distinguishing equipment in the shot's subject field, within its word limit. That field alone is searched; action and visualDirection do not refine the stock query. Prefer common observable actions with usable framing. Do not replace the required actor or activity with scenery, a different sport or a loosely related setting. Preserve fictional or comic narration, but do not depend on stock showing an exact invented expression or sequence; choose an illustrative action that supports the beat."] : []),
  "For a very short answer whose ending alone fulfills the request, development may be empty and no developing shots are needed. Otherwise, develop the essential content before the ending.",
  "The brief's ending is saved and played after your developing shots. Do not repeat it as a shot. Stop writing after the last developing shot. No technical events, identifiers, template choices, media providers, URLs or extra fields.",
  "Every shot uses moving footage with separate narration and subtitles. Generated footage is silent: do not ask its subjects to speak or render words. No headline cards or on-screen explanatory text.",
  `Each clip has at most ${clipDurationSec} seconds. Write spoken beats that fit naturally, usually ${Math.floor(clipDurationSec * 1.6)}–${Math.floor(clipDurationSec * 2)} words per shot. Split longer ideas across purposeful shots, preserving facts and qualifiers. Never truncate a claim to meet a word target. Use only the shots needed within the total duration, including the ending; do not pad to a fixed count.`,
  "Identify the full answer and its ending before developing shots. Each action must support what is said: camera movement alone is not progression. Vary scale, viewpoint and meaningful details while keeping subjects consistent.",
  "Explanations: clarify the actual causal mechanism, separating physical cause from a metaphor. Generated cutaways and animation illustrate ideas; they are not factual evidence. Preserve uncertainty, quantities and conditions; never invent evidence or quotations.",
  "Stories: portray characters making choices and experiencing consequences; use consistent character descriptions and an earned resolution, not a promised next scene.",
  "Comedy: establish the premise, time the visual or spoken reveal, allow a reaction beat, and stop on the payoff without explaining the joke.",
  "Imagination: make the impossible action concrete, establish the world's internal rules and keep its imagery consistent. Do not replace imagination with an explanation of it.",
  "Practical answers: show usable actions in their necessary order, with framing that makes the method and result visible. Preserve essential steps and relevant safety conditions. Match the requested experience level. For beginners, explain an unavoidable technical term in ordinary words or replace it with an observable action. Make the essential setup and a useful success cue explicit. Qualify advice that depends on equipment, task or conditions instead of presenting one setup as universal. Never add unsupported precision merely to sound instructional.",
  openingAlreadyProvided ? "The supplied opening has already been spoken. Preserve it and begin the body with new content." : "The brief opening is spoken during preparation. The first body shot must develop it rather than repeat its words or claim.",
  "Use continuity=continue when the same subject/action should remain coherent; choose cut for a purposeful new view. Describe recurring subjects consistently. Never assume a different angle or generated depiction proves a factual claim.",
 ].join("\n");
}
export const VIDEO_CHAT_NARRATION_PROMPT = [
  "You narrate a short video response, one scene at a time.",
  "You are given the scene about to be shown, and the lines already said before it.",
  "",
  "Return only the line to say over this scene. No JSON, no quotes, no preamble.",
  "Use the requested tone and natural spoken language. Keep this beat concise enough for its planned duration; preserve dialogue, a short punchline or practical instructions when appropriate.",
  "Say only what this scene contributes. Preserve the requested form: narrate a story as a story, give recommendations directly, and explain only when the user asked for an explanation.",
  "Never jump ahead to a later scene or repeat a line already said.",
  "Never read the on-screen text back word for word - the viewer can already see it.",
  "Continue naturally from the lines before it. Never mention scenes, videos or slides.",
].join("\n");

export const VIDEO_CHAT_SUGGESTIONS_PROMPT = [
  "You suggest what a user might prompt next after receiving a video response.",
  'Return JSON only: {"suggestions": [{"prompt": string, "keyword": string}]} with exactly four entries.',
  "prompt: one clear, specific follow-up in 4–8 words. Never exceed 8 words or 60 characters, including spaces. These are small mobile cards, not full instructions.",
  "Ask about one idea. Use context from the answer instead of restating it. No combined questions, preambles, lists of examples, or requests to visualize multiple things.",
  "Treat the entire VIDEO RESPONSE as already answered, including its causes, mechanisms and conclusions. Reject any candidate whose answer is already given there, even as a paraphrase or a narrower question. Before returning, compare all four candidates with that coverage and with one another; replace overlaps with a new consequence, application, counterfactual or adjacent unanswered idea.",
  "Match the response intent: continue or change a fictional story, try a different comic premise, explore another imagined setting, apply a practical method, or deepen an unanswered part of an explanation. Never add a factual explanation to a joke by default.",
  "keyword: two to four words naming something filmable that stands for the prompt, for stock footage search. Concrete subjects only - no abstractions, no text on screen.",
].join("\n");

export function createNarrationUserPrompt(
  prompt: string,
  scene: Pick<VideoScene, "templateId" | "variables">,
  earlier: readonly string[],
): string {
  return [
    `USER PROMPT: ${prompt}`,
    earlier.length > 0 ? `\nSAID SO FAR:\n${earlier.map((line) => `- ${line}`).join("\n")}` : "",
    `\nTHIS SCENE: [${scene.templateId}] ${JSON.stringify(scene.variables).slice(0, 4_000)}`,
  ].join("\n");
}
