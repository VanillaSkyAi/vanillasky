export interface DocumentationError { file: string; line: number; message: string }
export function checkDocs(root: string, trackedFiles?: string[]): DocumentationError[];
