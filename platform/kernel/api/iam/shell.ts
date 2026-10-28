import type { ModuleManifest } from '@itrms/module-sdk';

import type { SettingsRegistry } from '../settings/registry';
import type { Catalogues } from './menu';

/** What the application shell is computed from: the enabled manifests, their message catalogues and their settings. */
export interface Shell {
    manifests: readonly ModuleManifest[];
    messages: Catalogues;
    /** the settings the enabled slices declare (ADR-0026); none without */
    settings?: SettingsRegistry;
}

export const SHELL = Symbol('kernel.shell');
