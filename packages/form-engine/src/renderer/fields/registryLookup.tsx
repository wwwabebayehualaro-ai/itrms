'use client';

/**
 * A registry lookup (task 0.18): pick a person or an organisation from a registry by typing. The answer is the record's id
 * and nothing else; its label and facts are read from the registry each time (a read-only list under the box), so a form
 * never keeps a copy of a record that has since changed. A saved answer whose record is merged or no longer visible says so.
 */
import { useState } from 'react';

import { Combobox } from '@itrms/ui';
import { useQueryClient } from '@tanstack/react-query';

import { text as str } from '../../core/runtime/path';
import { rememberLookupItem, useLookupItems, useLookupSearch, type LookupItem } from '../../host/lookups';
import { useEngineText } from '../../host/text';
import { defineFieldType, type ValueFieldProps } from '../kit';

function Facts({ item, label }: { item: LookupItem; label: string }) {
    const shown = item.facts.filter((f) => f.value !== null && f.value !== '');
    if (!shown.length) return null;
    return (
        <dl aria-label={label} className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            {shown.map((f) => (
                <div key={f.key} className="contents">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd>{f.value}</dd>
                </div>
            ))}
        </dl>
    );
}

export function RegistryLookupField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<string | null | undefined>) {
    const { t } = useEngineText();
    const queryClient = useQueryClient();
    const provider = str(field.props.provider);
    const showFacts = field.props.showFacts !== false;
    const [search, setSearch] = useState('');
    const current = typeof value === 'string' && value !== '' ? value : undefined;
    const saved = useLookupItems(provider, current ? [current] : []);
    const found = saved.data?.find((i) => i.id === current);
    const results = useLookupSearch(provider, disabled ? '' : search);

    // a record already chosen stays in the list, whatever the search found
    const options = (found && !results.items.some((i) => i.id === found.id) ? [found] : [])
        .concat(results.items)
        .map((i) => ({ value: i.id, label: i.label }));
    const emptyMessage = results.failed
        ? t('form-engine.renderer.lookup.failed')
        : results.tooShort
          ? t('form-engine.renderer.lookup.minChars')
          : results.searching
            ? t('form-engine.renderer.lookup.searching')
            : t('form-engine.renderer.lookup.noResults');
    const missing = !!current && saved.isSuccess && !found;
    const status = missing
        ? t('form-engine.renderer.lookup.notFound')
        : found && !found.active
          ? t('form-engine.renderer.lookup.inactive')
          : undefined;

    const facts =
        found && showFacts ? <Facts item={found} label={t('form-engine.renderer.lookup.factsLabel')} /> : null;
    const note = status ? (
        <p role="status" className="mt-1 text-xs text-destructive">
            {status}
        </p>
    ) : null;

    if (disabled)
        return (
            <div id={id} aria-describedby={describedBy}>
                <span className="text-sm">
                    {found?.label ?? (current && saved.isPending ? t('form-engine.renderer.lookup.searching') : '')}
                </span>
                {facts}
                {note}
            </div>
        );

    return (
        <div>
            <Combobox
                id={id}
                options={options}
                value={current ?? null}
                onChange={(v) => {
                    const item = results.items.find((i) => i.id === v);
                    if (item) rememberLookupItem(queryClient, provider, item);
                    onChange(v);
                }}
                onSearchChange={setSearch}
                fallbackLabel={found?.label}
                placeholder={str(field.props.placeholder) || t('form-engine.renderer.lookup.placeholder')}
                searchPlaceholder={t('form-engine.renderer.lookup.searchPlaceholder')}
                emptyMessage={emptyMessage}
                loading={saved.isFetching && !!current && !found}
                loadingLabel={t('form-engine.renderer.lookup.searching')}
                clearable
                clearLabel={t('form-engine.renderer.lookup.clear')}
                invalid={invalid}
                aria-describedby={describedBy}
                onOpenChange={(o) => !o && onBlur()}
            />
            {facts}
            {note}
        </div>
    );
}

defineFieldType({ kind: 'value', type: 'RegistryLookup', Render: RegistryLookupField });
