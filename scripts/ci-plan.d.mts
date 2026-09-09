export function classifyChanges(paths: string[]): "docs" | "server" | "full";
export function assertCiResults(kind: string, jobs: Record<string, { result: string }>): void;
export function deploymentRequired(plan: unknown, commit: string): boolean;
