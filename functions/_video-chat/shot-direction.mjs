function optionalText(value, maximum, field) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > maximum) throw new Error(`Invalid ${field}`);
  return value.trim() || undefined;
}

/** Keep visual direction separate from literal stock vocabulary. */
export function compileShotPrompt(query, { scene, generatedLook, orientation } = {}) {
  const subject = optionalText(query, 80, 'media subject');
  if (!subject) throw new Error('A media subject is required');
  const direction = optionalText(scene?.variables?.shotDirection, 1600, 'shot direction');
  const look = optionalText(generatedLook, 500, 'generated look');
  return [
    `Subject: ${subject}.`,
    direction ? `Shot direction: ${direction}` : undefined,
    look ? `Visual treatment: ${look}` : undefined,
    orientation === 'portrait' ? 'Compose the subject for a vertical 9:16 frame.' : 'Compose the subject for a horizontal 16:9 frame.',
    'Follow the authored visual style and action in one continuous five-second shot. Keep the subject or environment in continuous motion appropriate to the scene. Quiet moments can use subtle expressions, breathing or moving fabric. A stationary camera is valid; no freeze frames or held still images.',
    'Include subtle natural ambient and action sounds that match the visible scene. Keep them quiet and unobtrusive, without sudden loud effects. No music, human voices, speech, narration, dialogue, singing or voiceover. No overlaid text, captions, subtitles, watermarks or logos.',
  ].filter(Boolean).join('\n');
}
