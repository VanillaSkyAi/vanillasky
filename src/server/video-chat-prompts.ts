import type { VideoScene } from "../protocol/types.js";

/** Small early shot plus an ordered, narrated hybrid plan. Providers remain host-owned. */
export function createVideoChatResponseInstructions(
  generatedVideoAvailable: boolean,
  openingAlreadyProvided = false,
  maxGeneratedVideos = 5,
): string {
 return [
  "Respond as a coherent short film: establish, develop, then land a useful or emotional payoff. Match the user's requested form.",
  generatedVideoAvailable
   ? 'First emit one host-consumed opening JSON object: {"type":"video-chat.opening","spokenHook":"6-9 words","mediaKeyword":"literal subject","firstShot":{"text":"short grounded fallback","narration":"one natural sentence advancing the hook","mediaKeyword":"2-8 concrete words","shotDirection":"optional framing and action"}}. Include firstShot only when a distinctive illustrative shot serves the story; omit it for an abstract explanation best opened with graphics. When present, the host inserts it once and begins generation immediately; do not emit it again.'
   : openingAlreadyProvided ? "Start directly with scene.add; the opening has already been supplied."
   : 'First emit {"type":"video-chat.opening","spokenHook":"6-9 words","mediaKeyword":"literal subject"}. This is host-consumed, not a scene.',
  openingAlreadyProvided ? "Preserve the supplied opening exactly; continue it without repeating its words or claim." : undefined,
  "The spokenHook is already heard before the first scene. Start firstShot.narration with the next fact, cause, action or consequence; never restate the hook. The first ordinary scene must then advance beyond firstShot rather than repeat its narration or opening claim. If firstShot is omitted, that first scene must advance the hook directly. firstShot.text, fallbackText and chapter titles must also express that new beat, not reuse the hook or prior shot copy; write a short complete grounded thought within the schema budget, never a clipped statistic or qualifying clause.",
  "Continue with only as many scenes as the story and duration need. Never pad to a fixed count. Every emitted scene carries narration beside variables and timing; no additional narration request should be needed.",
  "Make most of the film relevant footage: use full-bleed media for action, subjects and atmosphere, with graphics only to clarify a specific relationship or piece of evidence. Maintain consistent setting, lighting and subject while varying shot scale. Avoid unrelated cinematic montages.",
  "Use the installed catalog: ordered events, comparison, exact quote, one key figure, chapter or a message only when its narrative job fits. At most one graphic-led explanatory beat per 30 seconds, plus a brief chapter opening when needed. Do not place graphic beats consecutively unless no honest relevant media is available. Give media-capable graphics a relevant background when it supports the meaning; keep black when no matching media exists. Do not force every template into a video or use lists of bullets.",
  `At most ${generatedVideoAvailable ? maxGeneratedVideos : 0} generated-video attempts are available. Media scenes choose mediaSource=generate for distinctive illustrative shots or mediaSource=stock for generic verified imagery. A stock miss is not permission to broaden essential details. Do not spend generation on every scene.`,
  "Each mediaKeyword is a literal filmable subject/action, 2–8 words, maximum 80 characters. Use optional shotDirection for action, camera framing and continuity; it does not change the literal stock subject. Supply a short grounded fallbackText when the schema declares it. Do not put visible headline text over full-bleed footage.",
  "No invented quotations, attribution, statistics, personal evidence or URLs. Creative stories may be invented when requested; do not present generated illustration as historical evidence.",
  'Emit exactly one final placement:"closer" scene using a catalog template with a suitable payoff or ask job. It should land the meaning, not recap the whole answer.',
  "Every scene needs timing, even an empty object. Narration forms one continuous spoken explanation, uses natural sentence lengths, and does not read every on-screen word back. Finish with plan.complete.",
 ].filter((line): line is string=>line!=null).join("\n");
}
export const VIDEO_CHAT_NARRATION_PROMPT = [
  "You narrate a short video response, one scene at a time.",
  "You are given the scene about to be shown, and the lines already said before it.",
  "",
  "Return only the line to say over this scene. No JSON, no quotes, no preamble.",
  "One sentence, 10-16 words, plain spoken English.",
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
  "Examples: How do atoms gain electrons? Why do atoms bond? What holds the nucleus together? Can an atom split? Suggestions may continue, remix, deepen, compare, or apply the answer; stay relevant to its topic.",
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
