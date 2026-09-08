import type { VideoStyle } from "../src/protocol/types";

export const TEST_VIDEO_BRAND = {
  font: "Inter",
  scriptFont: "Caveat",
  background: { type: "gradient", colors: ["#8711C1", "#2167E3"] },
  colors: {
    primary: "#6D5EF5",
    secondary: "#17122F",
    foreground: "#FFFFFF",
    surface: "#090712",
    surfaceElevated: "#231B42",
    muted: "#A7A6B0",
  },
};

export const TEST_VIDEO_STYLE = {} satisfies VideoStyle;
