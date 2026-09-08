/**
 * Loads the backdrop preloader on demand.
 *
 * Warming media is background work — nothing on screen waits for it — so it
 * has no business in the bundle a consumer pays for before first paint. The
 * chunk is fetched the first time a scene with a backdrop appears, still far
 * ahead of that scene playing. Same treatment as control-visibility.
 *
 * A failed byte warm leaves readiness to the actual mounted media element.
 */
export function warmSceneMedia(variables: Record<string, unknown>, signal?: AbortSignal): void {
  void import("./preload-media.js")
    .then((module) => module.preloadSceneMedia(variables, signal))
    .catch(() => {});
}
