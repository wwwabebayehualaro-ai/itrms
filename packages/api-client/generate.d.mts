// Types of generate.mjs (the generator stays a plain script, runnable without a build).
export const CONTRACT: string;
export const TYPES: string;
export function generateTypes(document?: unknown): Promise<string>;
