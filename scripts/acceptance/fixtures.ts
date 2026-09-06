export interface ChatFixture {
  id: string;
  prompt: string;
  hook: string;
  subject: string;
  titles: string[];
  lines: string[];
  mode?: "cinematic" | "pexels";
  recovery?: "provider" | "allowance";
}

const currents = {
  prompt: "Explain ocean currents.", hook: "Ocean currents carry warmth around the world.", subject: "ocean currents",
  titles: ["Warm water on the move", "Heat travels with currents"],
  lines: ["Warm water travels through the ocean.", "Currents move heat around the world."],
};
export const ACCEPTANCE_FIXTURES: ChatFixture[] = [
  { id: "explanation", prompt: "Why does the Moon show one face?", hook: "The Moon turns once around its orbit.", subject: "moon", titles: ["One rotation per orbit", "A matching motion"], lines: ["The Moon rotates once per orbit.", "That matching motion keeps one face toward Earth."] },
  { id: "follow-up", prompt: "Explain that with a simple analogy.", hook: "Imagine walking around a friend while turning.", subject: "walking around a friend", titles: ["Keep facing your friend", "One trip, one turn"], lines: ["Walk around a friend while facing them.", "You turn once during one trip around them."] },
  { id: "creative", prompt: "Invent a tiny fox discovering the Moon.", hook: "A tiny fox found a silver ladder.", subject: "fox on the moon", titles: ["A ladder of moonbeams", "Tea on the Moon"], lines: ["The fox climbed a ladder of moonbeams.", "At the top, the Moon offered tea."] },
  { ...currents, id: "pexels", mode: "pexels" },
  { ...currents, id: "ai-chapter-recovery", recovery: "provider" },
  { ...currents, id: "pexels-chapter-recovery", mode: "pexels", recovery: "provider" },
  { ...currents, id: "ai-allowance-recovery", recovery: "allowance" },
];

export function replayParts(fixture: ChatFixture) {
  const shots = fixture.lines.map((narration, index) => ({ narration, title: fixture.titles[index], subject: fixture.subject,
    action: `Show ${fixture.subject} moving clearly.`, durationSec: 5, continuity: "cut" }));
  return [
    { type: "answer", intent: fixture.id === "creative" ? "story" : "explanation",
      opening: fixture.hook, subject: fixture.subject, visualDirection: "Clear purposeful illustration.",
      development: "Develop the spoken answer.", ending: shots.at(-1) },
    ...shots.slice(0, -1).map((shot) => ({ type: "shot", ...shot })),
  ];
}
