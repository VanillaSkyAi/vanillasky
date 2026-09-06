import { defineTemplate } from "@vanillaskyai/video/templates";

export const activationLift = defineTemplate({
  id: "activationLift",
  label: "Activation lift",
  description: "A project-owned view of an activation metric before and after an improvement.",
  useWhen: "Use when the source contains an exact activation percentage before and after a change.",
  avoidWhen: "Avoid when the source does not contain both grounded percentages.",
  family: "Explainers",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, maxLength: 64, default: "Activation improved" },
      previous: { type: "string", format: "grounded-stat", minLength: 1, maxLength: 8, default: "41%" },
      current: { type: "string", format: "grounded-stat", minLength: 1, maxLength: 8, default: "58%" },
      explanation: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        default: "Guided onboarding helped more users reach value.",
      },
    },
    required: ["title", "previous", "current", "explanation"],
    additionalProperties: false,
    "x-vanillasky": { requiresStat: true },
  } as const,
  examples: [{
    name: "Guided onboarding",
    variables: {
      title: "Activation improved",
      previous: "41%",
      current: "58%",
      explanation: "Guided onboarding helped more users reach value.",
    },
  }],
  minDuration: 4,
  preferredDuration: 6,
  component: ({ variables, progress, width, height, safeZone }) => {
    const reveal = Math.max(0, Math.min(1, progress * 1.5));
    return <section style={{
      boxSizing: "border-box",
      width,
      height,
      padding: `${safeZone.top}px ${safeZone.right}px ${safeZone.bottom}px ${safeZone.left}px`,
      display: "grid",
      alignContent: "center",
      gap: height >= width ? 32 : 20,
      color: "#f8f7ff",
      background: "linear-gradient(145deg, #11152c, #34357d 58%, #7867dd)",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    }}>
      <p style={{ margin: 0, opacity: 0.72, fontSize: Math.max(22, width * 0.03) }}>
        {variables.title}
      </p>
      <strong style={{
        fontSize: Math.max(72, Math.min(width * 0.2, 210)),
        lineHeight: 0.9,
        letterSpacing: "-0.06em",
        opacity: reveal,
        transform: `translateY(${Math.round((1 - reveal) * 24)}px)`,
      }}>
        {variables.current}
      </strong>
      <p style={{ margin: 0, fontSize: Math.max(22, width * 0.035), lineHeight: 1.35 }}>
        Up from {variables.previous}. {variables.explanation}
      </p>
    </section>;
  },
});
