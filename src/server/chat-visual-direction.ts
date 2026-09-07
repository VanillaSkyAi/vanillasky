export type AnswerIntent = 'explanation' | 'practical' | 'story' | 'comedy' | 'imagination';
export type AnswerVisualStyle = 'illustrated' | 'realistic' | 'cinematic';

const defaults: Record<AnswerIntent, AnswerVisualStyle> = {
  explanation: 'illustrated', practical: 'realistic', story: 'cinematic', comedy: 'cinematic', imagination: 'cinematic',
};
const bibles: Record<AnswerVisualStyle, string> = {
  illustrated: 'Illustrated visual language: clear shaped forms, restrained texture and a coherent limited palette. Use readable spatial relationships, cutaways and purposeful motion to reveal the idea. Keep the same design of subjects and materials across shots.',
  realistic: 'Realistic visual language: natural light, credible materials, consistent colour and true physical proportions. Use unobstructed framing and meaningful close views so actions and results are easy to observe. Keep subjects, equipment and setting consistent.',
  cinematic: 'Cinematic visual language: intentional lighting, coherent colour and tactile detail. Use purposeful changes of shot scale and viewpoint, with clear action, consequence and a readable final frame. Preserve character appearance and the established world across cuts.',
};

/** Private first-brief metadata. Never infer new record types or expose new protocol fields. */
export function compileVisualDirection(brief: { intent?: unknown; visualStyle?: unknown; visualDirection?: unknown }, callerLook?: string) {
  const intent: AnswerIntent = typeof brief.intent === 'string' && Object.hasOwn(defaults, brief.intent) ? brief.intent as AnswerIntent : 'explanation';
  const visualStyle: AnswerVisualStyle = typeof brief.visualStyle === 'string' && Object.hasOwn(bibles, brief.visualStyle) ? brief.visualStyle as AnswerVisualStyle : defaults[intent];
  const visualDirection = typeof brief.visualDirection === 'string' && brief.visualDirection.trim().length <= 600 ? brief.visualDirection.trim() : '';
  const explicit = typeof callerLook === 'string' && callerLook.trim().length <= 1000 ? callerLook.trim() : '';
  return { intent, visualStyle, visualDirection, generatedLook: explicit || bibles[visualStyle] };
}
