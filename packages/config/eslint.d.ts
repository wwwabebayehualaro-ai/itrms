import type { Linter } from 'eslint';

export default function config(options: { dir: string; node?: boolean }): Linter.Config[];
