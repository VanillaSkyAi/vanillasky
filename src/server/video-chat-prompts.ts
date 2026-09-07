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
  'Use the exact record type "answer" for the first brief and "shot" for developing beats. Output JSON records only, with no prose outside them, including when explaining a limitation.',
  "Write a complete, intentful video answer as newline-delimited JSON. Match the user's form and tone; mixed intents can combine directions.",
  `First write one brief: {"type":"answer","intent":"explanation|story|comedy|imagination|practical","visualStyle":"illustrated|realistic|cinematic","opening":"one useful spoken line of 4–7 ordinary words","subject":"literal visual subject","development":"the essential development of this answer","visualDirection":"consistent subjects, appearance and visual approach","ending":{"title":"short meaningful chapter title, at most 65 characters","narration":"the authored payoff","subject":"literal subject","action":"visible action or change","durationSec":${clipDurationSec},"continuity":"cut|continue"}}.`,
  "The opening should take roughly 2–3 seconds at a natural pace: give the core answer, a useful starting cue, or the story's immediate situation. No greeting, topic announcement, promise to explain, or description of loading. Never compress away an essential qualifier just to hit the word target.",
  `Then stream each developing shot on its own line: {"type":"shot","title":"short meaningful chapter title, at most 65 characters","narration":"the exact spoken beat","subject":"2–8 literal filmable words, at most 80 characters","action":"concrete subject, action or visible change and useful framing","durationSec":${clipDurationSec},"continuity":"cut|continue"}.`,
  `The selected footage mode is ${mode === "pexels" ? "Pexels stock search: use literal filmable subjects; never imply stock proves a mechanism or depicts fictional events exactly" : `AI video, with at most ${generatedVideoAvailable ? maxGeneratedVideos : 0} generation attempts`}. Missing footage becomes the authored chapter title, with complete narration. Never truncate already-authored narration when footage fails. The host selects providers; do not make source choices.`,
  ...(mode === "cinematic" ? [generatedVideoAvailable && maxGeneratedVideos > 0
    ? `Plan at most ${maxGeneratedVideos} generated-video beats in total, including the saved ending. Use at most ${maxGeneratedVideos - 1} developing shot records; the ending uses the remaining beat. The opening chapter does not consume a generated clip. Before writing, choose a concise, complete treatment that fits this budget: combine related ideas, preserve essential facts and qualifiers, and finish the requested answer. Do not plan an extra chapter tail simply because generation attempts will run out.${maxGeneratedVideos === 1 ? ' Put the complete answer in the saved ending, set development to an empty string, and emit no developing shot records.' : ''}`
    : "No generated-video attempts are available; plan a complete chapter-led answer with a useful ending. Do not omit the answer to satisfy a zero clip budget."] : []),
  ...(mode === "pexels" ? ["Stock queries must retain the essential subject, activity and distinguishing equipment in the shot's subject field, within its word limit. That field alone is the search query; action and visualDirection do not refine it. Prefer common observable actions with usable framing. Do not replace the required actor or activity with scenery, a different sport or a loosely related setting. Preserve fictional or comic narration, but do not depend on stock showing an exact invented expression or sequence; choose an illustrative action that supports the beat."] : []),
  ...(mode === "pexels" ? ["Choose a separate stock subject for each beat, describing footage that can realistically exist in a stock library. For historical, abstract or unseen events, use relevant present-day evidence, objects, environments or analogous visible processes as clearly illustrative support. Do not require literal footage of events or subjects that cannot realistically be filmed. Keep the causal explanation in narration; do not claim illustrative footage records the historical event or proves the mechanism. Make stockSelection describe the chosen visible subject, not the overall topic. Do not use illustrative freedom to replace a required practical action, person, sport or distinguishing equipment with unrelated scenery."] : []),
  ...(mode === "pexels" ? ['Include stockSelection on every shot and the saved ending when the essential subject is known: "stockSelection":{"subject":"essential actor or object category","activity":"optional literal activity","equipment":"optional distinguishing equipment","exclude":["optional contradictory subject or activity"]}. Each phrase must be 1–4 words and at most 48 characters; exclude has at most 3 phrases. The essential subject is separate from the setting: do not use scenery, mood, camera framing or incidental appearance as the actor. Keep the search query broad enough to find footage; the optional hint helps select results without substituting a different actor or task. Use exclusions only for actual contradictions, not every detail absent from the story. Omit unknown fields or the whole hint rather than inventing an anchor. This is selection guidance, not verification that footage depicts the exact narration.'] : []),
  "Choose one of the five intents and one visualStyle in the first brief. Default explanation to illustrated, practical to realistic, and story, comedy or imagination to cinematic. An explicit visual-style request can choose any of the three. Put its specific medium, palette, character appearance and setting in visualDirection; keep those details consistent through the ending. A supplied caller visual direction takes precedence over these defaults and must not be contradicted.",
  "The visualStyle names describe generated footage only. Stock mode selects existing literal footage; it cannot redraw or restyle that footage.",
  "Keep development to one concise sentence and visualDirection to the few details needed for consistency. Emit the complete brief, then the first developing shot immediately when developing shots are needed and allowed by the budget; otherwise end after the brief. Continue the same stream without an outline, recap or second planning pass. The saved ending must still contain the complete payoff before the brief is emitted.",
  "For a very short answer whose ending alone fulfills the request, development may be empty and no developing shots are needed. Otherwise, develop the essential content before the ending.",
  "The brief's ending is saved and played after your developing shots. Do not repeat it as a shot. Stop writing after the last developing shot. No technical events, identifiers, template choices, media providers, URLs or unlisted fields.",
  "Every shot uses moving footage with separate narration and subtitles. Generated footage is silent: do not ask its subjects to speak or render words. No headline cards or on-screen explanatory text.",
  `Each clip has at most ${clipDurationSec} seconds. Write spoken beats that fit naturally, usually ${Math.floor(clipDurationSec * 1.6)}–${Math.floor(clipDurationSec * 2)} words per shot. Split longer ideas across purposeful shots, preserving facts and qualifiers. Never truncate a claim to meet a word target. Use only the shots needed within the total duration, including the ending; do not pad to a fixed count.`,
  "Identify the full answer and its ending before developing shots. Each shot should carry one clear action or change, timed to the narration of that beat; do not describe an outcome before its shot. Use framing that lets the viewer see the relevant action, not just its setting. Each action must support what is said: camera movement alone is not progression. Vary scale, viewpoint and meaningful details while keeping subjects consistent.",
  "Explanations: answer the actual question first, then show the essential causal link rather than a tour of the topic. Clarify the actual causal mechanism, separating physical cause from a metaphor. Generated cutaways and animation illustrate ideas; they are not factual evidence. Preserve uncertainty, quantities and conditions; never invent evidence or quotations.",
  "Comparisons and choices: Compare the same criteria for both alternatives, using only supported or supplied differences. Finish with the requested choice and the condition that makes it appropriate; if evidence is insufficient, say what is missing. Do not invent scores, advantages or a winner. Use explanation or practical intent as appropriate, not a new record type.",
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
