import type { ModuleManifest } from '@itrms/module-sdk';

import type { Catalogues } from './menu';

/** What the application shell is computed from: the enabled manifests and their message catalogues. */
export interface Shell {
    manifests: readonly ModuleManifest[];
    messages: Catalogues;
}

export const SHELL = Symbol('kernel.shell');
