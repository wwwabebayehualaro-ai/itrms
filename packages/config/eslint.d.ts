import type { Linter } from 'eslint';

export default function config(options: { dir: string; node?: boolean; react?: boolean }): Linter.Config[];
