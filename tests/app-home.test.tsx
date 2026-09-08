// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Home } from "../app/pages/Home";
vi.mock("../src/react", () => ({ VideoChat: ({ options }: { options: { mode: string } }) => <div data-testid="chat" data-mode={options.mode} /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("starts with the server-selected Pexels mode when generated video is absent", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ready: true, missing: [], videoMode: "pexels", speech: "browser" })));
  render(<Home />);
  expect((await screen.findByTestId("chat")).getAttribute("data-mode")).toBe("pexels");
});
it("does not mount a conversation when real planning is unconfigured", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ready: false, missing: ["ANTHROPIC_API_KEY"], videoMode: "pexels" })));
  render(<Home />);
  expect(await screen.findByRole("heading", { name: "Set up video chat" })).toBeTruthy();
  expect(screen.queryByTestId("chat")).toBeNull();
  expect(screen.getByText("AI planning: ANTHROPIC_API_KEY")).toBeTruthy();
});
