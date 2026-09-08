/** Leave a short visual tail after the narration finishes. Shared by planning and playback. */
export const CLIP_NARRATION_TAIL_SEC = .8;

const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;

/** Conservative preflight only. Decoded speech duration remains authoritative. */
export function estimateNarrationSeconds(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  const characters = normalized.match(UNSPACED_SCRIPT)?.length ?? 0;
  const words = normalized.replace(UNSPACED_SCRIPT, " ").match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const pauses = normalized.match(/[.!?。！？;；:：]/gu)?.length ?? 0;
  return words / 2.2 + characters / 3.5 + pauses * .15;
}

export function speechFitsClip(seconds: number, durationSec: number): boolean {
  return Number.isFinite(seconds) && seconds >= 0 && Number.isFinite(durationSec) && durationSec > 0
    && seconds + CLIP_NARRATION_TAIL_SEC <= durationSec + 1e-6;
}

export function narrationFitsClip(text: string, durationSec: number): boolean {
  return speechFitsClip(estimateNarrationSeconds(text), durationSec);
}
