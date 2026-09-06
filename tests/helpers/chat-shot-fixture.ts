export const chatShot = (subject: string, narration = `A distinct action reveals ${subject}.`) => ({
  type: "shot", narration, subject, action: `A clear view shows ${subject} changing across the shot.`, durationSec: 5, continuity: "cut",
});
export const chatAnswer = (ending: ReturnType<typeof chatShot>, opening = "Watch this small story come alive.", subject = "garden", development = "A meaningful sequence develops before its ending.") => ({
  type: "answer", intent: "story", opening, subject, development,
  visualDirection: "A consistent illustrated world with clear physical actions.", ending,
});
export async function* streamChatShots(shots = [chatShot("planting seeds"), chatShot("a blooming garden")], opening?: string, subject?: string) {
  yield JSON.stringify(chatAnswer(shots.at(-1)!, opening, subject, shots.length > 1 ? "Each action leads to the next." : "")) + "\n";
  for (const shot of shots.slice(0, -1)) yield JSON.stringify(shot) + "\n";
}
