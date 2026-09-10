export type AnswerIntent = 'explanation' | 'practical' | 'story' | 'comedy' | 'imagination';

const intents: readonly AnswerIntent[] = ['explanation', 'practical', 'story', 'comedy', 'imagination'];
const defaultLook = 'Default to photorealistic cinematic imagery with carefully composed frames, believable proportions, detailed physical surfaces, natural variation, motivated lighting and realistic depth. Keep colour restrained and motion physically plausible. Explanatory cutaways, transparent layers and simplified geometry retain realistic materials and lighting, with clear spatial relationships. An explicit user-requested aesthetic in the shot direction takes precedence over this default.';

/** Private planner metadata with one shared default; caller direction takes precedence. */
export function compileVisualDirection(brief: { intent?: unknown; visualDirection?: unknown }, callerLook?: string) {
  const intent: AnswerIntent = typeof brief.intent === 'string' && intents.includes(brief.intent as AnswerIntent) ? brief.intent as AnswerIntent : 'explanation';
  const visualDirection = typeof brief.visualDirection === 'string' && brief.visualDirection.trim().length <= 600 ? brief.visualDirection.trim() : '';
  const explicit = typeof callerLook === 'string' && callerLook.trim().length <= 1000 ? callerLook.trim() : '';
  return { intent, visualDirection, generatedLook: explicit || defaultLook };
}
