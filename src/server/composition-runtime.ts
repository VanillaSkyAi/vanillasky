import type { VideoProviderLifecycleResult, VideoGenerationLifecycleSink } from "./lifecycle.js";
import { safePublicDiagnostic } from "../protocol/warnings.js";

export function invokeIsolated<T>(callback: ((value: T) => unknown) | undefined, value: T): void {
  if (!callback) return;
  try {
    void Promise.resolve(callback(value)).catch(() => undefined);
  } catch {
    // Lifecycle observers cannot alter generation or the client response.
  }
}

export function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function safeAbortReason(value: unknown): string {
  if (value instanceof DOMException && value.name === "TimeoutError") return "Request timed out";
  if (value instanceof Error && value.name === "TimeoutError") return "Request timed out";
  return safePublicDiagnostic(value instanceof Error ? value.message : value, "Request aborted");
}

export function createId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

export function createProviderLifecycle(): {
  sink: VideoGenerationLifecycleSink;
  drainWarnings: () => VideoProviderLifecycleResult["warnings"];
  settle: () => Promise<VideoProviderLifecycleResult>;
} {
  const results: Array<Promise<VideoProviderLifecycleResult>> = [];
  const reportedWarnings: VideoProviderLifecycleResult["warnings"] = [];
  const deliveredWarnings = new Set<string>();
  const takeWarnings = (warnings: VideoProviderLifecycleResult["warnings"]) => warnings.filter(warning => {
    const key = `${warning.code}\u0000${warning.category}\u0000${warning.message}\u0000${warning.sceneId ?? ""}`;
    if (deliveredWarnings.has(key)) return false;
    deliveredWarnings.add(key);
    return true;
  });
  const drainWarnings = () => takeWarnings(reportedWarnings.splice(0));
  const sink: VideoGenerationLifecycleSink = {
    reportWarning(warning) { reportedWarnings.push(warning); },
    registerProviderResult(result) {
      results.push(result);
    },
  };
  const settle = async (): Promise<VideoProviderLifecycleResult> => {
    const resolved = await Promise.all(results);
    const uniqueWarnings = takeWarnings([...reportedWarnings.splice(0), ...resolved.flatMap((result) => result.warnings)]);
    return resolved.reduce<VideoProviderLifecycleResult>((summary, result) => ({
      ...summary,
      ...result,
      warnings: uniqueWarnings,
    }), { warnings: uniqueWarnings });
  };
  return { sink, drainWarnings, settle };
}
