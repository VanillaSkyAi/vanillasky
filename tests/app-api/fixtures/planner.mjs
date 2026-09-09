// Provider double for API transport tests; never imported by the application.
export async function* plannerStream() {
  const shot = (narration) => ({ narration, subject: "moon", action: "The Moon rotates in space.", durationSec: 5, continuity: "cut" });
  yield JSON.stringify({ type: "answer", intent: "explanation", opening: "The Moon turns with its orbit", subject: "moon", development: "Rotation and orbit stay in step." }) + "\n";
  yield JSON.stringify({ type: "shot", ...shot("The Moon turns once each orbit.") }) + "\n";
  yield JSON.stringify({ type: "ending", ...shot("Rotation and orbit stay in step.") }) + "\n";
}
