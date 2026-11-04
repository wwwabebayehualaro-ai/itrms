'use client';

/**
 * The daily statements of revenue offices and banks (task 0.22c): a finance officer imports one, the worker reads it, and
 * this page shows how far it got and the lines a person must look at. The layout is a marked placeholder until a real one
 * is known.
 */
import { useRef, useState } from 'react';
import { z } from 'zod';
import {
    Button,
    EmptyState,
    EthiopianDatePicker,
    Field,
    FieldLabel,
    Input,
    PageHeader,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useNotify,
    useZodForm,
    ZodForm,
    type Tone
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import {
    STATEMENT_LINE_PAGE,
    useExternalIssuers,
    useImportStatement,
    useStatementLines,
    useStatements,
    type StatementLineOut,
    type StatementOut
} from '@/lib/fees';
import { formatDay, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { ErrorsOf, todayInAddis } from './form-bits';

const MAX_BYTES = 512 * 1024;

const STATE_TONE: Record<StatementOut['state'], Tone> = {
    received: 'progress',
    matching: 'progress',
    processed: 'success',
    failed: 'danger'
};
const LINE_TONE: Record<StatementLineOut['state'], Tone> = {
    unmatched: 'muted',
    matched: 'success',
    amount_mismatch: 'danger',
    held: 'progress',
    duplicate: 'muted',
    invalid: 'danger'
};

export function StatementsPage() {
    const { t } = useText();
    const mayImport = useCan('external-statement:import');
    const statements = useStatements();
    const [open, setOpen] = useState<string | null>(null);
    const items = statements.data?.items ?? [];
    return (
        <div className="flex flex-col gap-6" data-screen="statements">
            <PageHeader title={t('fees.statement.title')} description={t('fees.statement.intro')} />
            {mayImport && <ImportForm />}
            {statements.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : statements.error ? (
                <EmptyState
                    variant="error"
                    title={t('fees.statement.error')}
                    description={getApiErrorMessage(statements.error)}
                />
            ) : items.length === 0 ? (
                <EmptyState title={t('fees.statement.empty')} description={t('fees.statement.emptyHint')} />
            ) : (
                <StatementTable statements={items} open={open} onOpen={setOpen} />
            )}
            {open && (
                <Lines
                    key={open}
                    statementId={open}
                    live={items.some((s) => s.id === open && (s.state === 'received' || s.state === 'matching'))}
                />
            )}
        </div>
    );
}

function ImportForm() {
    const { t, text, language } = useText();
    const notify = useNotify();
    const issuers = useExternalIssuers();
    const importing = useImportStatement();
    const fileInput = useRef<HTMLInputElement>(null);
    const [filename, setFilename] = useState('');
    const schema = z.object({
        issuer: z.string().min(1, t('fees.external.invalid.issuer')),
        statementDate: z.string().min(1, t('fees.external.invalid.paidOn')),
        content: z.string().min(1, t('fees.statement.badHeader'))
    });
    const form = useZodForm({
        schema,
        defaultValues: { issuer: '', statementDate: '', content: '' },
        onSubmit: async (v) => {
            await importing.mutateAsync({ ...v, filename });
            notify.success(t('fees.statement.imported'));
            form.reset();
            setFilename('');
            if (fileInput.current) fileInput.current.value = '';
        }
    });
    return (
        <section className="flex flex-col gap-3 rounded-md border p-4" data-statement-import>
            <h2 className="font-medium">{t('fees.statement.importTitle')}</h2>
            <ZodForm form={form}>
                <div className="grid gap-4 sm:grid-cols-3">
                    <form.AppField name="issuer">
                        {(f) => (
                            <f.SelectField
                                label={t('fees.statement.issuer')}
                                placeholder={t('fees.statement.issuerPlaceholder')}
                                options={(issuers.data?.items ?? []).map((i) => ({
                                    value: i.code,
                                    label: text(i.name)
                                }))}
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="statementDate">
                        {(field) => (
                            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                                <FieldLabel htmlFor="statement-date">{t('fees.statement.placeholderDate')}</FieldLabel>
                                <EthiopianDatePicker
                                    id="statement-date"
                                    value={field.state.value || null}
                                    onChange={(v) => field.handleChange(v ?? '')}
                                    onOpenChange={(isOpen) => !isOpen && field.handleBlur()}
                                    language={language === 'en' ? 'en' : 'am'}
                                    max={todayInAddis()}
                                    labels={{
                                        placeholder: t('fees.payment.pickDate'),
                                        previousMonth: t('fees.payment.previousMonth'),
                                        nextMonth: t('fees.payment.nextMonth'),
                                        clear: t('fees.payment.clear'),
                                        month: t('fees.payment.month'),
                                        year: t('fees.payment.year')
                                    }}
                                />
                                <ErrorsOf errors={field.state.meta.errors} touched={field.state.meta.isTouched} />
                            </Field>
                        )}
                    </form.AppField>
                    <form.AppField name="content">
                        {(field) => (
                            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                                <FieldLabel htmlFor="statement-file">{t('fees.statement.file')}</FieldLabel>
                                <Input
                                    id="statement-file"
                                    ref={fileInput}
                                    type="file"
                                    accept=".csv,text/csv"
                                    onBlur={field.handleBlur}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        if (file.size > MAX_BYTES) {
                                            notify.error(t('fees.statement.tooBig'));
                                            e.target.value = '';
                                            return;
                                        }
                                        setFilename(file.name.slice(0, 200));
                                        void file.text().then((content) => field.handleChange(content));
                                    }}
                                />
                                <p className="text-muted-foreground text-xs">{t('fees.statement.fileHint')}</p>
                                <ErrorsOf errors={field.state.meta.errors} touched={field.state.meta.isTouched} />
                            </Field>
                        )}
                    </form.AppField>
                </div>
                <div className="flex justify-end">
                    <form.AppForm>
                        <form.SubmitButton data-action="import-statement">
                            {t('fees.statement.import')}
                        </form.SubmitButton>
                    </form.AppForm>
                </div>
            </ZodForm>
        </section>
    );
}

function StatementTable({
    statements,
    open,
    onOpen
}: {
    statements: StatementOut[];
    open: string | null;
    onOpen: (id: string) => void;
}) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const issuers = useExternalIssuers();
    return (
        <Table data-statements>
            <TableHeader>
                <TableRow>
                    <TableHead>{t('fees.statement.col.date')}</TableHead>
                    <TableHead>{t('fees.statement.col.issuer')}</TableHead>
                    <TableHead>{t('fees.statement.col.file')}</TableHead>
                    <TableHead>{t('fees.statement.col.state')}</TableHead>
                    <TableHead className="text-right">{t('fees.statement.col.matched')}</TableHead>
                    <TableHead className="text-right">{t('fees.statement.col.open')}</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {statements.map((s) => {
                    const issuer = issuers.data?.items.find((i) => i.code === s.issuer);
                    const matched = s.counts.matched ?? 0;
                    const toLook = Object.entries(s.counts).reduce(
                        (sum, [state, n]) => (state === 'matched' ? sum : sum + (n ?? 0)),
                        0
                    );
                    return (
                        <TableRow key={s.id} data-statement={s.id} data-state={s.state}>
                            <TableCell>{formatDay(s.statementDate, { language, calendar })}</TableCell>
                            <TableCell>{issuer ? text(issuer.name) : s.issuer}</TableCell>
                            <TableCell className="max-w-xs truncate">{s.filename}</TableCell>
                            <TableCell>
                                <StatusBadge
                                    value={s.state}
                                    tone={STATE_TONE[s.state]}
                                    label={t(`fees.statement.state.${s.state}`)}
                                />
                                {s.failure && (
                                    <p className="text-destructive text-xs">
                                        {t(`fees.statement.failure.${s.failure}`)}
                                    </p>
                                )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{matched}</TableCell>
                            <TableCell className="text-right">
                                <Button
                                    size="sm"
                                    variant={open === s.id ? 'default' : 'outline'}
                                    data-action="open-lines"
                                    onClick={() => onOpen(s.id)}
                                >
                                    {toLook}
                                </Button>
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}

/** The lines a person must look at, in file order. */
function Lines({ statementId, live }: { statementId: string; live: boolean }) {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    // the line each page before this one ended at
    const [cursors, setCursors] = useState<number[]>([]);
    const lines = useStatementLines(statementId, cursors[cursors.length - 1] ?? 0, live);
    if (lines.isPending) return <Skeleton className="h-24 w-full" />;
    if (lines.error)
        return (
            <EmptyState
                variant="error"
                title={t('fees.statement.error')}
                description={getApiErrorMessage(lines.error)}
            />
        );
    const items = lines.data.items;
    return (
        <section className="flex flex-col gap-3">
            <h2 className="font-medium">{t('fees.statement.lines')}</h2>
            {items.length === 0 && cursors.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('fees.statement.linesEmpty')}</p>
            ) : (
                <Table data-statement-lines>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('fees.statement.line.no')}</TableHead>
                            <TableHead>{t('fees.statement.line.reference')}</TableHead>
                            <TableHead className="text-right">{t('fees.statement.line.amount')}</TableHead>
                            <TableHead>{t('fees.statement.line.date')}</TableHead>
                            <TableHead>{t('fees.statement.line.state')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((l) => (
                            <TableRow key={l.id} data-line={l.lineNo} data-state={l.state}>
                                <TableCell className="tabular-nums">{l.lineNo}</TableCell>
                                <TableCell>{l.reference ?? '—'}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {l.amountSantim === null ? '—' : formatMoney(l.amountSantim, language)}
                                </TableCell>
                                <TableCell>{l.paidOn ? formatDay(l.paidOn, { language, calendar }) : '—'}</TableCell>
                                <TableCell>
                                    <StatusBadge
                                        value={l.state}
                                        tone={LINE_TONE[l.state]}
                                        label={t(`fees.statement.lineState.${l.state}`)}
                                    />
                                    {l.reason && (
                                        <p className="text-muted-foreground text-xs">
                                            {t(`fees.statement.lineReason.${l.reason}`)}
                                        </p>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            {(cursors.length > 0 || items.length === STATEMENT_LINE_PAGE) && (
                <div className="flex items-center justify-end gap-2">
                    <Button
                        variant="outline"
                        disabled={cursors.length === 0}
                        onClick={() => setCursors((c) => c.slice(0, -1))}
                    >
                        {t('fees.cashier.previous')}
                    </Button>
                    <Button
                        variant="outline"
                        disabled={items.length < STATEMENT_LINE_PAGE}
                        onClick={() => {
                            const last = items[items.length - 1];
                            if (last) setCursors((c) => [...c, last.lineNo]);
                        }}
                    >
                        {t('fees.cashier.next')}
                    </Button>
                </div>
            )}
        </section>
    );
}
