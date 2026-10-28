/**
 * The web app's messages (i18n-and-languages.md, task 0.13): the shell's catalogue and every installed slice's, merged.
 * Keys are flat in the catalogues (`competency.nav.applications`) and nested here, the shape next-intl reads. A missing
 * text falls back `wal-Latn → am → en`; `pnpm i18n:check` keeps `am` and `en` complete.
 */
import competencyAm from '@itrms/competency/messages/am';
import competencyEn from '@itrms/competency/messages/en';
import competencyWal from '@itrms/competency/messages/wal-Latn';
import formsAm from '@itrms/forms/messages/am';
import formsEn from '@itrms/forms/messages/en';
import formsWal from '@itrms/forms/messages/wal-Latn';
import kernelAm from '@itrms/kernel/messages/am';
import kernelEn from '@itrms/kernel/messages/en';
import kernelWal from '@itrms/kernel/messages/wal-Latn';
import partiesAm from '@itrms/parties/messages/am';
import partiesEn from '@itrms/parties/messages/en';
import partiesWal from '@itrms/parties/messages/wal-Latn';
import workflowAm from '@itrms/workflow/messages/am';
import workflowEn from '@itrms/workflow/messages/en';
import workflowWal from '@itrms/workflow/messages/wal-Latn';
import { fallbackChain, SHIPPED_LANGUAGES } from '@itrms/schemas';

import shellAm from '../../messages/am.json';
import shellEn from '../../messages/en.json';
import shellWal from '../../messages/wal-Latn.json';

/** The languages the shell has catalogues for; a region's others (om, ti) show Amharic until theirs are added. */
export const UI_LANGUAGES = SHIPPED_LANGUAGES;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: UiLanguage = 'am';

type Flat = Readonly<Record<string, string>>;
type Nested = { [key: string]: string | Nested };

const CATALOGUES: Readonly<Record<UiLanguage, readonly Flat[]>> = {
    am: [shellAm, kernelAm, formsAm, workflowAm, partiesAm, competencyAm],
    en: [shellEn, kernelEn, formsEn, workflowEn, partiesEn, competencyEn],
    'wal-Latn': [shellWal, kernelWal, formsWal, workflowWal, partiesWal, competencyWal]
};

/** `{ "a.b": "x" }` → `{ a: { b: "x" } }`; a key that is also another's prefix is a catalogue error. */
export function nest(flat: Flat, into: Nested = {}): Nested {
    for (const [key, text] of Object.entries(flat)) {
        const parts = key.split('.');
        let node = into;
        parts.slice(0, -1).forEach((part) => {
            const next = node[part];
            if (typeof next === 'string') throw new Error(`message "${key}": "${part}" is a message itself`);
            node = node[part] = next ?? {};
        });
        const leaf = parts[parts.length - 1] ?? key;
        if (typeof node[leaf] === 'object') throw new Error(`message "${key}" is also a prefix of others`);
        node[leaf] = text;
    }
    return into;
}

export const isUiLanguage = (value: unknown): value is UiLanguage =>
    (UI_LANGUAGES as readonly unknown[]).includes(value);

/** The messages of a language, its gaps filled along the fallback chain. */
export function messagesFor(language: UiLanguage): Nested {
    const chain = fallbackChain(language).filter(isUiLanguage).reverse();
    const merged: Nested = {};
    for (const tag of chain) for (const catalogue of CATALOGUES[tag]) nest(catalogue, merged);
    return merged;
}
