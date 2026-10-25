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
import { toStored, writeText } from './document';
import { useDesigner, useDesignerActions } from './store';

const PAGE_SIZE = 100;

/** A language named in itself, else its tag. */
export function endonym(tag: string): string {
    const known = INSTALLABLE_LANGUAGES.find((l) => l === tag);
    return known ? LANGUAGE_ENDONYMS[known] : tag;
}

const isRequired = (tag: string) => (REQUIRED_TEXT_LANGUAGES as readonly string[]).includes(tag);

const KIND: Record<FieldText['kind'], string> = {
    label: 'Label',
    helpText: 'Help text',
    placeholder: 'Placeholder',
    option: 'Option',
    message: 'Message'
};

const kindOf = (t: FieldText) =>
    t.kind === 'option' ? `Option ${t.ref ?? ''}` : t.kind === 'message' ? `Message: ${t.ref ?? ''}` : KIND[t.kind];

interface Row extends FieldText {
    /** unique in the form */
    rowKey: string;
    fieldId: string;
    fieldLabel: string;
}

/** The translation table of the form being built, in a side sheet. */
export function TranslationsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-6xl" data-translations>
                <SheetHeader>
                    <SheetTitle>Translations</SheetTitle>
                    <SheetDescription>
                        Every text of the form in each language. Amharic and English are required; a text missing in
                        another language is shown in the language it falls back to.
                    </SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4">{open && <Translations />}</div>
            </SheetContent>
        </Sheet>
    );
}

export function Translations() {
    const doc = useDesigner((s) => s.doc);
    const plainAs = useDesigner((s) => s.plainAs);
    const actions = useDesignerActions();
    const { language: pageLanguage, languages } = useFormsLanguages();
    const fields = useMemo(() => toStored(doc).fields, [doc]);

    // every text that has a value in some language, in the form's order
    const rows = useMemo<Row[]>(
        () =>
            fields.flatMap((field) =>
                fieldTexts(field)
                    .filter((t) => !!formTextIn(t.value, plainAs))
                    .map((t): Row => ({
                        ...t,
                        rowKey: `${field.id}:${t.path}`,
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
                        aria-label="Search the texts"
                        placeholder="Search by field or text"
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
                    <Label htmlFor="only-untranslated">Only untranslated</Label>
                </div>
                <Badge variant="outline" data-untranslated-count>
                    <Languages />
                    {untranslated === 0 ? 'All translated' : `${untranslated} to translate`}
                </Badge>
            </div>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="min-w-44">Text</TableHead>
                        {languages.map((tag) => {
                            const missing = missingCount(tag);
                            return (
                                <TableHead key={tag} className="min-w-52" data-language={tag}>
                                    <div className="flex flex-col gap-0.5 py-1">
                                        <span className="text-sm font-medium text-foreground">{endonym(tag)}</span>
                                        <span className="text-xs font-normal text-muted-foreground">
                                            {isRequired(tag) ? 'required' : 'optional'}
                                            {missing > 0 && (
                                                <span className={isRequired(tag) ? ' text-status-warning-fg' : ''}>
                                                    {' · '}
                                                    {missing} {isRequired(tag) ? 'missing' : 'not translated'}
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
                        <TableRow key={row.rowKey} data-text-row={row.rowKey}>
                            <TableCell className="align-top whitespace-normal">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-medium">{row.fieldLabel}</span>
                                    <span className="font-mono text-xs text-muted-foreground">{row.fieldId}</span>
                                    <span className="text-xs text-muted-foreground">{kindOf(row)}</span>
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
                                                aria-label={`${row.fieldLabel}, ${kindOf(row)}, ${endonym(tag)}`}
                                                value={own}
                                                placeholder={own === '' ? fallback : undefined}
                                                onChange={(e) => write(row, tag, e.target.value)}
                                            />
                                            {own === '' &&
                                                (required ? (
                                                    <span className="text-xs text-status-warning-fg" data-missing>
                                                        Missing
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground" data-not-translated>
                                                        Not translated
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
                                {rows.length === 0 ? 'The form has no texts yet.' : 'No text matches.'}
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
                        Previous
                    </Button>
                    <span>
                        Page {current + 1} of {pages}
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={current >= pages - 1}
                        onClick={() => setPage(current + 1)}
                    >
                        Next
                        <ChevronRight />
                    </Button>
                </div>
            )}
        </div>
    );
}
