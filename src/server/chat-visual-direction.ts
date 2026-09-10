export type AnswerIntent = 'explanation' | 'practical' | 'story' | 'comedy' | 'imagination';
export type AnswerVisualStyle = 'illustrated' | 'realistic';

const intents: readonly AnswerIntent[] = ['explanation', 'practical', 'story', 'comedy', 'imagination'];
const bibles: Record<AnswerVisualStyle, string> = {
  // Illustration vocabulary adapted from h3-max-education; see THIRD_PARTY_NOTICES.md.
  illustrated: 'Educational 2D animation with irregular ink outlines, flat cel shading, subtle paper texture and sparse halftone. Compose bold cutout shapes with generous empty space and gentle depth between layers. Use an ivory, black, cobalt, rust and ochre palette. Animate the concept with clear, continuous purposeful movement and consistent subject design. Keep the rendering graphic and drawn, without photographic textures, shiny 3D surfaces or interface elements.',
  realistic: 'Live-action documentary cinematography with carefully composed photographic framing. Show believable proportions and weight, detailed physical surfaces and natural irregularities appropriate to the subject. Use motivated light, restrained colour, realistic shadows and optical depth. Keep movement physically plausible and the camera steady or moving deliberately. Preserve a filmed appearance throughout, without illustration, plastic-looking CGI or synthetic gloss.',
};

/** Private first-brief metadata. Never infer new record types or expose new protocol fields. */
export function compileVisualDirection(brief: { intent?: unknown; visualStyle?: unknown; visualDirection?: unknown }, callerLook?: string) {
  const intent: AnswerIntent = typeof brief.intent === 'string' && intents.includes(brief.intent as AnswerIntent) ? brief.intent as AnswerIntent : 'explanation';
  const visualStyle: AnswerVisualStyle = typeof brief.visualStyle === 'string' && Object.hasOwn(bibles, brief.visualStyle) ? brief.visualStyle as AnswerVisualStyle : 'realistic';
  const visualDirection = typeof brief.visualDirection === 'string' && brief.visualDirection.trim().length <= 600 ? brief.visualDirection.trim() : '';
  const explicit = typeof callerLook === 'string' && callerLook.trim().length <= 1000 ? callerLook.trim() : '';
  return { intent, visualStyle, visualDirection, generatedLook: explicit || bibles[visualStyle] };
}
