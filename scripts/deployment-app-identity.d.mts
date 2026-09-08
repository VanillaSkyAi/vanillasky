export interface AppIdentity {
  commit: string;
  sourceSha256: string;
}
export function createAppIdentity(root?: string): AppIdentity;
export function assertAppIdentity(identity: unknown): AppIdentity;
export function renderAppMetaTags(identity: AppIdentity): string;
export function assertAppMarkup(markup: string, expected: AppIdentity): void;
