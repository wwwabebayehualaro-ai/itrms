'use client';

/**
 * A form's test cases: values a person could enter and what the engine must answer. They are saved with the form, run on
 * every publish check (a failing case blocks the publication) and here, in the browser, on the same core runner.
 */
import { useId, useMemo, useState } from 'react';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    IconButton,
    Input,
    Label,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    useNotify
} from '@itrms/ui';

import { MAX_TEST_CASES, mismatchText, runTestCases, type FormTestCase } from '../core';
import { useEngineText } from '../host/text';
import { toStored } from './document';
import { useDesigner, useDesignerActions, useDesignerApi } from './store';

/** A test case id from its name: lower-case letters, digits and hyphens, unique among `taken`. */
function caseId(name: string, taken: ReadonlySet<string>): string {
    const base =
        name
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 50) || 'case';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
}

/**
 * What the engine answers to these values, as a case's expectation: valid, or invalid with the fields that fail. Found by
 * running the core runner against a first guess and reading what differs, so the builder holds no rule of its own.
 */
function expectationFor(stored: unknown, base: Omit<FormTestCase, 'expect'>): FormTestCase['expect'] {
    const withExpect = (expect: FormTestCase['expect']) => ({
        ...(typeof stored === 'object' && stored ? stored : {}),
        testCases: [{ ...base, expect }]
    });
    const probe = runTestCases(withExpect({ valid: false, errors: {} }))[0];
    if (!probe) return { valid: true };
    if (probe.mismatches.some((m) => m.path === 'valid')) return { valid: true };
    const errors: Record<string, true> = {};
    for (const m of probe.mismatches) if (m.path.startsWith('errors.')) errors[m.path.slice('errors.'.length)] = true;
    return { valid: false, errors };
}

/** "Save as test case" in the preview: the values entered so far become a case, its expectation filled from the runner. */
export function SaveAsTestCase({ values }: { values: Record<string, unknown> }) {
    const { t } = useEngineText();
    const notify = useNotify();
    const store = useDesignerApi();
    const actions = useDesignerActions();
    const count = useDesigner((s) => s.doc.testCases?.length ?? 0);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const nameId = useId();
    const save = () => {
        const { doc, language } = store.getState();
        const existing = doc.testCases ?? [];
        const trimmed = name.trim();
        if (!trimmed || existing.length >= MAX_TEST_CASES) return;
        const base = {
            id: caseId(trimmed, new Set(existing.map((c) => c.id))),
            name: trimmed,
            language,
            values: structuredClone(values)
        };
        const created: FormTestCase = { ...base, expect: expectationFor(toStored(doc), base) };
        actions.setTestCases([...existing, created]);
        setOpen(false);
        setName('');
        notify.success(t('form-engine.designer.tests.saved', { name: trimmed }));
    };
    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={count >= MAX_TEST_CASES}
                onClick={() => setOpen(true)}
                data-save-test-case
            >
                <FlaskConical />
                {t('form-engine.designer.tests.saveAs')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('form-engine.designer.tests.saveAsTitle')}</DialogTitle>
                        <DialogDescription>{t('form-engine.designer.tests.saveAsDescription')}</DialogDescription>
                    </DialogHeader>
                    <form
                        className="grid gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            save();
                        }}
                    >
                        <Label htmlFor={nameId}>{t('form-engine.designer.tests.name')}</Label>
                        <Input
                            id={nameId}
                            value={name}
                            maxLength={200}
                            autoFocus
                            onChange={(e) => setName(e.target.value)}
                        />
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                                {t('form-engine.designer.tests.cancel')}
                            </Button>
                            <Button type="submit" disabled={!name.trim()}>
                                {t('form-engine.designer.tests.save')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}

export function TestCasesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const { t, language } = useEngineText();
    const actions = useDesignerActions();
    const doc = useDesigner((s) => s.doc);
    const cases = useMemo(() => doc.testCases ?? [], [doc.testCases]);
    const results = useMemo(() => (open ? runTestCases(toStored(doc)) : []), [open, doc]);
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>{t('form-engine.designer.tests.title')}</SheetTitle>
                    <SheetDescription>{t('form-engine.designer.tests.description')}</SheetDescription>
                </SheetHeader>
                <div className="grid gap-3 px-4 pb-4" data-test-cases>
                    {cases.length === 0 && (
                        <p className="text-sm text-muted-foreground">{t('form-engine.designer.tests.empty')}</p>
                    )}
                    {cases.map((c, i) => {
                        const result = results.find((r) => r.id === c.id);
                        return (
                            <div key={c.id} className="grid gap-2 rounded-md border p-3" data-test-case={c.id}>
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={c.name}
                                        maxLength={200}
                                        aria-label={t('form-engine.designer.tests.name')}
                                        onChange={(e) =>
                                            actions.setTestCases(
                                                cases.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                                                `testCase:${c.id}`
                                            )
                                        }
                                    />
                                    {result && (
                                        <Badge variant={result.passed ? 'outline' : 'destructive'}>
                                            {result.passed
                                                ? t('form-engine.designer.tests.passed')
                                                : t('form-engine.designer.tests.failed')}
                                        </Badge>
                                    )}
                                    <IconButton
                                        label={t('form-engine.designer.tests.delete')}
                                        size="icon-xs"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => actions.setTestCases(cases.filter((_, j) => j !== i))}
                                    >
                                        <Trash2 />
                                    </IconButton>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {c.expect.valid
                                        ? t('form-engine.designer.tests.expectsValid')
                                        : t('form-engine.designer.tests.expectsInvalid', {
                                              fields: Object.keys(c.expect.errors ?? {}).join(', ')
                                          })}
                                </p>
                                {result?.mismatches.map((m) => (
                                    <p key={m.path} className="text-xs text-destructive">
                                        {mismatchText(language, m)}
                                    </p>
                                ))}
                            </div>
                        );
                    })}
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Plus className="size-3" aria-hidden />
                        {t('form-engine.designer.tests.howToAdd')}
                    </p>
                </div>
            </SheetContent>
        </Sheet>
    );
}
