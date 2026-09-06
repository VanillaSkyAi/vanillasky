export interface ChatFixture {
  id: string;
  prompt: string;
  hook: string;
  lines: string[];
  provider?: "stock" | "failed";
}

export const ACCEPTANCE_FIXTURES: ChatFixture[] = [
  { id: "explanation", prompt: "Why does the Moon show one face?", hook: "The Moon turns once around its orbit.", lines: ["The Moon rotates once per orbit.", "That matching motion keeps one face toward Earth."] },
  { id: "follow-up", prompt: "Explain that with a simple analogy.", hook: "Imagine walking around a friend while turning.", lines: ["Walk around a friend while facing them.", "You turn once during one trip around them."] },
  { id: "creative", prompt: "Invent a tiny fox discovering the Moon.", hook: "A tiny fox found a silver ladder.", lines: ["The fox climbed a ladder of moonbeams.", "At the top, the Moon offered tea."] },
  { id: "stock-fallback", prompt: "Explain ocean currents.", hook: "Ocean currents carry warmth around the world.", lines: ["Warm water travels through the ocean.", "Currents move heat around the world."], provider: "stock" },
  { id: "unavailable-visuals", prompt: "Explain ocean currents without available footage.", hook: "Ocean currents carry warmth around the world.", lines: ["Warm water travels through the ocean.", "Currents move heat around the world."], provider: "failed" },
];

export function replayParts(fixture: ChatFixture) {
  const subject = fixture.provider ? "ocean currents" : "moon";
  const shots = fixture.lines.map((narration) => ({ narration, subject,
    action: `Show ${subject} moving clearly.`, durationSec: 5, continuity: "cut" }));
  return [
    { type: "answer", intent: fixture.id === "creative" ? "story" : "informational",
      opening: fixture.hook, subject, visualDirection: "Clear purposeful illustration.",
      development: "Develop the spoken answer.", ending: shots.at(-1) },
    ...shots.slice(0, -1).map((shot) => ({ type: "shot", ...shot })),
  ];
}
