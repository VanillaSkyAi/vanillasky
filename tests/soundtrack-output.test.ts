// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import attachSoundtrack from "../src/player/control-visibility";

afterEach(async () => { document.body.replaceChildren(); await Promise.resolve(); vi.restoreAllMocks(); });

it.each(["chat", "player"])("routes fixed-volume music for a %s owner through shuffle and cleanup", async owner => {
  vi.spyOn(HTMLMediaElement.prototype, "volume", "get").mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, "volume", "set").mockImplementation(() => {});
  const container = document.createElement("div");
  if (owner === "chat") container.dataset.soundtrackOwner = "";
  else container.dataset.testid = "video-player";
  const createAudio = () => {
    const audio = document.createElement("audio");
    audio.src = "/music.mp3";
    audio.dataset.v = ".2";
    container.append(audio);
    return audio;
  };
  const first = createAudio();
  document.body.append(container);
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = { createMediaElementSource: vi.fn(() => source), createGain: vi.fn(() => gain),
    destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  attachSoundtrack(first, context as unknown as AudioContext);
  expect(context.createMediaElementSource).toHaveBeenCalledWith(first);
  first.volume = .07;
  expect(gain.gain.value).toBe(.07);
  const second = createAudio();
  await Promise.resolve();
  expect(context.createMediaElementSource).toHaveBeenCalledWith(second);
  const button = document.createElement("button");
  container.append(button);
  button.click();
  expect(context.resume).toHaveBeenCalled();
  container.remove();
  await Promise.resolve();
  expect(context.close).toHaveBeenCalled();
  expect(source.disconnect).toHaveBeenCalled();
});
