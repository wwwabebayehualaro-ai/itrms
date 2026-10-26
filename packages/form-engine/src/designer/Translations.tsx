'use client';

/**
 * The form's texts in every language (task 0.17a): one row per translatable text (labels, help texts, placeholders,
 * option labels, messages), one column per language of the installation. Amharic and English are required (a missing text
 * is a warning on publishing, never a block); the others are reported and fall back. Cells write into the builder's document,
 * so every change is undoable like any other.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Languages, Search } from 'lucide-react';
import {
    Badge,
    Button,
    Input,
    Label,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@itrms/ui';
import {
    INSTALLABLE_LANGUAGES,
    LANGUAGE_ENDONYMS,
    REQUIRED_TEXT_LANGUAGES,
    fieldTexts,
    formTextIn,
    missingIn,
    ownText,
    type FieldText
} from '@itrms/schemas';
import { untranslatedTexts } from '../core';
import { useFormsLanguages } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import type { EngineMessageKey, EngineTranslate } from '../core/messages';
import { toStored, writeText } from './document';
import { useDesigner, useDesignerActions } from './store';

const PAGE_SIZE = 100;

/** A language named in itself, else its tag. */
export function endonym(tag: string): string {
    const known = INSTALLABLE_LANGUAGES.find((l) => l === tag);
    return known ? LANGUAGE_ENDONYMS[known] : tag;
}

const isRequired = (tag: string) => (REQUIRED_TEXT_LANGUAGES as readonly string[]).includes(tag);

const KIND = {
    label: 'form-engine.designer.translations.kind.label',
    helpText: 'form-engine.designer.translations.kind.helpText',
    placeholder: 'form-engine.designer.translations.kind.placeholder'
} as const;

/** The builder's name of a setting text, by the setting (or binding) it is stored under. */
const SETTING: Record<string, EngineMessageKey> = {
    header: 'form-engine.designer.translations.setting.title',
    legend: 'form-engine.designer.translations.setting.title',
    title: 'form-engine.designer.translations.setting.title',
    subTitle: 'form-engine.designer.translations.setting.subtitle',
    footer: 'form-engine.designer.translations.setting.footer',
    description: 'form-engine.designer.translations.setting.description',
    content: 'form-engine.designer.translations.setting.dividerText',
    itemLabel: 'form-engine.designer.translations.setting.rowName',
    addButtonLabel: 'form-engine.designer.translations.setting.addRowButton',
    removeButtonLabel: 'form-engine.designer.translations.setting.removeRowButton',
    emptyMessage: 'form-engine.designer.translations.setting.noRows',
    chooseLabel: 'form-engine.designer.translations.setting.uploadButton',
    optionsEmpty: 'form-engine.designer.translations.setting.noOptions',
    rowsEmpty: 'form-engine.designer.translations.setting.noRows'
};

const kindOf = (t: EngineTranslate, text: FieldText) => {
    switch (text.kind) {
        case 'option':
            return t('form-engine.designer.translations.kind.option', { ref: text.ref ?? '' });
        case 'message':
            return t('form-engine.designer.translations.kind.message', { ref: text.ref ?? '' });
        case 'column':
            return t('form-engine.designer.translations.kind.column', { ref: text.ref ?? '' });
        case 'setting': {
            const named = SETTING[text.ref ?? ''];
            return named ? t(named) : (text.ref ?? t('form-engine.designer.translations.kind.setting'));
        }
        default:
            return t(KIND[text.kind]);
    }
};

interface Row extends FieldText {
    /** unique in the form */
    rowKey: string;
    fieldId: string;
    fieldLabel: string;
}

/** The translation table of the form being built, in a side sheet. */
export function TranslationsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const textLanguage = useDesigner((s) => s.doc.textLanguage);
    const { t } = useEngineText();
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-6xl" data-translations>
                <SheetHeader>
                    <SheetTitle>{t('form-engine.designer.toolbar.translations')}</SheetTitle>
                    <SheetDescription>
                        {t('form-engine.designer.translations.intro')}{' '}
                        <span data-text-language={textLanguage}>
                            {t('form-engine.designer.translations.plainAs', { language: endonym(textLanguage) })}
                        </span>
                    </SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4">{open && <Translations />}</div>
            </SheetContent>
        </Sheet>
    );
}

export function Translations() {
    const { t } = useEngineText();
    const doc = useDesigner((s) => s.doc);
    const plainAs = doc.textLanguage;
    const actions = useDesignerActions();
    const { language: pageLanguage, languages } = useFormsLanguages();
    const fields = useMemo(() => toStored(doc).fields, [doc]);

    // every text that has a value in some language, in the form's order
    const rows = useMemo<Row[]>(
        () =>
            // a row is known by the field's place, not its key: typing an English label can rename a new field's key
            fields.flatMap((field, index) =>
                fieldTexts(field)
                    .filter((t) => !!formTextIn(t.value, plainAs))
                    .map((t): Row => ({
                        ...t,
                        rowKey: `${index}:${t.path}`,
                        fieldId: field.id,
                        fieldLabel: formTextIn(field.label, pageLanguage) || field.id
                    }))
            ),
        [fields, pageLanguage, plainAs]
    );
    const untranslated = useMemo(() => untranslatedTexts(fields, plainAs).length, [fields, plainAs]);
    const missingNow = () =>
        new Set(
            rows.filter((r) => REQUIRED_TEXT_LANGUAGES.some((l) => missingIn(r.value, l, plainAs))).map((r) => r.rowKey)
        );

    // The filter keeps the rows that were untranslated when it was switched on: a row must not leave the table under the
    // person typing in it, the moment its last missing text is filled in.
    const [only, setOnly] = useState(untranslated > 0);
    const [pinned, setPinned] = useState<Set<string>>(() => missingNow());
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);

    const term = search.trim().toLowerCase();
    const shown = rows.filter(
        (r) =>
            (!only || pinned.has(r.rowKey)) &&
            (!term ||
                r.fieldId.toLowerCase().includes(term) ||
                r.fieldLabel.toLowerCase().includes(term) ||
                languages.some((l) => ownText(r.value, l, plainAs).toLowerCase().includes(term)))
    );
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const current = Math.min(page, pages - 1);
    const visible = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

    const missingCount = (tag: string) => rows.filter((r) => missingIn(r.value, tag, plainAs)).length;

    const write = (row: Row, tag: string, value: string) => {
        if (row.path === 'label') return actions.relabel(row.fieldId, value, tag);
        actions.update(
            row.fieldId,
            (f) => void writeText(f, row.path, tag, value, plainAs),
            `${row.fieldId}:${row.path}:${tag}`
        );
    };

    return (
        <div className="flex flex-col gap-3" data-translations-table>
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-48 flex-1">
                    <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                    <Input
                        aria-label={t('form-engine.designer.translations.searchLabel')}
                        placeholder={t('form-engine.designer.translations.searchPlaceholder')}
                        className="pl-8"
                        value={search}
                        onChange={(e) => (setSearch(e.target.value), setPage(0))}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id="only-untranslated"
                        checked={only}
                        onCheckedChange={(v) => (setOnly(v), setPinned(missingNow()), setPage(0))}
                    />
                    <Label htmlFor="only-untranslated">{t('form-engine.designer.translations.onlyUntranslated')}</Label>
                </div>
                <Badge variant="outline" data-untranslated-count>
                    <Languages />
                    {untranslated === 0
                        ? t('form-engine.designer.translations.allTranslated')
                        : t('form-engine.designer.translations.toTranslate', { count: String(untranslated) })}
                </Badge>
            </div>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="min-w-44">{t('form-engine.designer.translations.text')}</TableHead>
                        {languages.map((tag) => {
                            const missing = missingCount(tag);
                            return (
                                <TableHead key={tag} className="min-w-52" data-language={tag}>
                                    <div className="flex flex-col gap-0.5 py-1">
                                        <span className="text-sm font-medium text-foreground">{endonym(tag)}</span>
                                        <span className="text-xs font-normal text-muted-foreground">
                                            {isRequired(tag)
                                                ? t('form-engine.designer.translations.required')
                                                : t('form-engine.designer.translations.optional')}
                                            {missing > 0 && (
                                                <span className={isRequired(tag) ? ' text-status-warning-fg' : ''}>
                                                    {' · '}
                                                    {t(
                                                        isRequired(tag)
                                                            ? 'form-engine.designer.translations.missingRequired'
                                                            : 'form-engine.designer.translations.missingOptional',
                                                        {
                                                            count: String(missing)
                                                        }
                                                    )}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                </TableHead>
                            );
                        })}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {visible.map((row) => (
                        <TableRow key={row.rowKey} data-text-row={`${row.fieldId}:${row.path}`}>
                            <TableCell className="align-top whitespace-normal">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-medium">{row.fieldLabel}</span>
                                    <span className="font-mono text-xs text-muted-foreground">{row.fieldId}</span>
                                    <span className="text-xs text-muted-foreground">{kindOf(t, row)}</span>
                                </div>
                            </TableCell>
                            {languages.map((tag) => {
                                const own = ownText(row.value, tag, plainAs);
                                const fallback = formTextIn(row.value, tag) ?? '';
                                const required = isRequired(tag);
                                return (
                                    <TableCell key={tag} className="align-top">
                                        <div className="flex flex-col gap-0.5">
                                            <Input
                                                aria-label={t('form-engine.designer.translations.cellLabel', {
                                                    field: row.fieldLabel,
                                                    kind: kindOf(t, row),
                                                    language: endonym(tag)
                                                })}
                                                value={own}
                                                placeholder={own === '' ? fallback : undefined}
                                                onChange={(e) => write(row, tag, e.target.value)}
                                            />
                                            {own === '' &&
                                                (required ? (
                                                    <span className="text-xs text-status-warning-fg" data-missing>
                                                        {t('form-engine.designer.translations.missing')}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground" data-not-translated>
                                                        {t('form-engine.designer.translations.notTranslated')}
                                                    </span>
                                                ))}
                                        </div>
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    ))}
                    {visible.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={languages.length + 1} className="text-center text-muted-foreground">
                                {rows.length === 0
                                    ? t('form-engine.designer.translations.noTexts')
                                    : t('form-engine.designer.translations.noMatch')}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>

            {pages > 1 && (
                <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={current === 0}
                        onClick={() => setPage(current - 1)}
                    >
                        <ChevronLeft />
                        {t('form-engine.designer.translations.previous')}
                    </Button>
                    <span>
                        {t('form-engine.designer.translations.page', {
                            current: String(current + 1),
                            pages: String(pages)
                        })}
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={current >= pages - 1}
                        onClick={() => setPage(current + 1)}
                    >
                        {t('form-engine.designer.translations.next')}
                        <ChevronRight />
                    </Button>
                </div>
            )}
        </div>
    );
}
