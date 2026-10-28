'use client';

/**
 * The region's languages (task 0.13): which of the installation's languages people may choose. Amharic and English are
 * always on. Read with its version from the region's settings and saved with
 * `PUT /api/v1/org-units/:region/settings/i18n.languages` and If-Match (`setting:update`, a seat at the region; task
 * 0.21a): another administrator's change since is refused, never overwritten. Below the region it is shown, not changed.
 * The API checks the value and the scope.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { INSTALLABLE_LANGUAGES, LANGUAGE_ENDONYMS } from '@itrms/schemas';
import { Button, Checkbox, Label, PageHeader, useNotify } from '@itrms/ui';
import client, { isApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/auth/authStore';
import { useText } from '@/lib/preferences';
import { useUnitSettings } from '@/lib/settings';

/** Each language named in itself. */
const OFFERED = INSTALLABLE_LANGUAGES.map((tag) => ({ tag, name: LANGUAGE_ENDONYMS[tag] }));
const ALWAYS = new Set(['am', 'en']);
const SETTING = 'i18n.languages';

export default function LanguagesPage() {
    const { t } = useText();
    const notify = useNotify();
    const queries = useQueryClient();
    const hydrate = useAuthStore((s) => s.hydrate);
    const regionId = useAuthStore((s) => s.workspace?.activeUnit.regionId);
    const settings = useUnitSettings(regionId);
    const found = settings.data?.settings.find((s) => s.key === SETTING);
    const setting = found && {
        value: Array.isArray(found.value) ? (found.value as string[]) : ['am', 'en'],
        version: found.own?.version ?? 0,
        writable: found.writable.unit
    };
    // the person's choice; until they make one, the saved list
    const [edited, setEdited] = useState<Set<string>>();
    const chosen = edited ?? new Set(setting?.value ?? ['am', 'en']);
    const [busy, setBusy] = useState(false);

    const toggle = (tag: string, on: boolean) => {
        const next = new Set(chosen);
        if (on) next.add(tag);
        else next.delete(tag);
        setEdited(next);
    };

    const save = async () => {
        if (!setting || !regionId) return;
        setBusy(true);
        try {
            await client.put(
                `v1/org-units/${regionId}/settings/${SETTING}`,
                { value: OFFERED.map((l) => l.tag).filter((tag) => ALWAYS.has(tag) || chosen.has(tag)) },
                { headers: { 'if-match': `"${setting.version}"` } }
            );
            setEdited(undefined);
            await Promise.all([queries.invalidateQueries({ queryKey: ['settings'] }), hydrate()]);
            notify.success(t('shell.languages.saved'));
        } catch (error) {
            // changed meanwhile by another administrator: show theirs, the person chooses again
            if (isApiError(error) && error.response?.status === 409) {
                setEdited(undefined);
                await queries.invalidateQueries({ queryKey: ['settings'] });
                notify.error(t('shell.languages.changed'));
            } else notify.error(t('shell.languages.failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex max-w-2xl flex-col gap-6">
            <PageHeader title={t('shell.languages.title')} description={t('shell.languages.intro')} />
            <ul className="flex flex-col gap-3">
                {OFFERED.map(({ tag, name }) => (
                    <li key={tag} className="flex items-center gap-3">
                        <Checkbox
                            id={`language-${tag}`}
                            checked={ALWAYS.has(tag) || chosen.has(tag)}
                            disabled={ALWAYS.has(tag) || busy || !setting?.writable}
                            onCheckedChange={(on) => toggle(tag, on === true)}
                        />
                        <Label htmlFor={`language-${tag}`} lang={tag}>
                            {name}
                        </Label>
                        {ALWAYS.has(tag) && (
                            <span className="text-xs text-muted-foreground">{t('shell.languages.always')}</span>
                        )}
                    </li>
                ))}
            </ul>
            <div>
                <Button type="button" onClick={() => void save()} disabled={busy || !setting?.writable}>
                    {t('shell.languages.save')}
                </Button>
            </div>
        </div>
    );
}
