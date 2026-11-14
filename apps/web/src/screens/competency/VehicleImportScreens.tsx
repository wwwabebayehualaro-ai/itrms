'use client';

/**
 * The bulk import of paper vehicle files (ADR-0054, task 1.13b). A clerk sends a sheet (from the template) with the scans of its
 * files; the worker checks every row as a back-capture is checked and the report gives each row's errors; a second person reads it
 * and commits the batch, and its valid rows join the register as migrated by import. Nothing joins the register before that.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFileActions } from '@itrms/form-engine/renderer';
import {
    Button,
    confirmAction,
    EmptyState,
    Input,
    Label,
    PageHeader,
    saveBlob,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    ToggleGroup,
    ToggleGroupItem,
    useNotify,
    type Tone
} from '@itrms/ui';
import {
    IMPORT_ROW_STATES,
    importTemplateCsv,
    MAX_IMPORT_CONTENT,
    type ImportRowState,
    type ImportState
} from '@itrms/competency/contracts';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { convertBlobToBase64 } from '@/lib/fileUtils';
import { formatMoment } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import {
    isWorking,
    ROWS_PAGE,
    scanLink,
    useCommitVehicleImport,
    useCreateVehicleImport,
    useDiscardVehicleImport,
    useVehicleImport,
    useVehicleImportRow,
    useVehicleImportRows,
    useVehicleImports,
    type VehicleImport,
    type VehicleImportRow
} from '@/lib/vehicle-imports';

const STATE_TONE: Record<ImportState, Tone> = {
    checking: 'progress',
    checked: 'info',
    failed: 'danger',
    committing: 'progress',
    committed: 'success',
    discarded: 'muted'
};
const ROW_TONE: Record<ImportRowState, Tone> = {
    valid: 'info',
    invalid: 'danger',
    already_imported: 'muted',
    imported: 'success'
};

function Counts({ batch }: { batch: VehicleImport }) {
    const { t } = useText();
    const { counts } = batch;
    return (
        <span data-import-counts className="text-sm">
            {t('competency.imports.counts', {
                total: String(counts.total),
                valid: String(counts.valid),
                invalid: String(counts.invalid),
                already: String(counts.alreadyImported),
                imported: String(counts.imported)
            })}
        </span>
    );
}

export function VehicleImports() {
    const { t, language } = useText();
    const { calendar } = usePreferences();
    const mayCreate = useCan('vehicle-import:create');
    const list = useVehicleImports();
    const items = list.data?.items ?? [];
    return (
        <div className="flex flex-col gap-6" data-screen="vehicle-imports">
            <PageHeader
                title={t('competency.imports.title')}
                description={t('competency.imports.intro')}
                actions={
                    mayCreate ? (
                        <Button asChild>
                            <Link href="/competency/vehicle-imports/new">{t('competency.imports.new')}</Link>
                        </Button>
                    ) : undefined
                }
            />
            {list.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : list.error ? (
                <EmptyState
                    variant="error"
                    title={t('competency.imports.error')}
                    description={getApiErrorMessage(list.error)}
                />
            ) : items.length === 0 ? (
                <EmptyState title={t('competency.imports.empty')} description={t('competency.imports.emptyHint')} />
            ) : (
                <Table data-imports>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('competency.imports.file')}</TableHead>
                            <TableHead>{t('competency.imports.sentBy')}</TableHead>
                            <TableHead>{t('competency.imports.state')}</TableHead>
                            <TableHead>{t('competency.imports.rows')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((b) => (
                            <TableRow key={b.id} data-import={b.id} data-state={b.state}>
                                <TableCell>
                                    <Link className="underline" href={`/competency/vehicle-imports/${b.id}`}>
                                        {b.filename}
                                    </Link>
                                </TableCell>
                                <TableCell>
                                    {b.createdBy.name} · {formatMoment(b.createdAt, { language, calendar })}
                                </TableCell>
                                <TableCell>
                                    <StatusBadge
                                        value={b.state}
                                        tone={STATE_TONE[b.state]}
                                        label={t(`competency.imports.status.${b.state}`)}
                                    />
                                </TableCell>
                                <TableCell>
                                    <Counts batch={b} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}

/** The format a picked sheet is sent as: a workbook by its extension, else CSV. */
const formatOf = (file: File): 'csv' | 'xlsx' => (/\.xlsx$/i.test(file.name) ? 'xlsx' : 'csv');

export function NewVehicleImport() {
    const { t } = useText();
    const router = useRouter();
    const notify = useNotify();
    const { uploadFile } = useFileActions();
    const create = useCreateVehicleImport();
    const [sheet, setSheet] = useState<File | null>(null);
    const [scans, setScans] = useState<File[]>([]);
    const [sent, setSent] = useState(0);
    const [busy, setBusy] = useState(false);

    const downloadTemplate = () =>
        saveBlob(new Blob([`﻿${importTemplateCsv()}`], { type: 'text/csv;charset=utf-8' }), 'paper-files-template.csv');

    const submit = async () => {
        if (!sheet) return;
        setBusy(true);
        try {
            const format = formatOf(sheet);
            const content = format === 'xlsx' ? await convertBlobToBase64(sheet) : await sheet.text();
            if (content.length > MAX_IMPORT_CONTENT) {
                notify.error(t('competency.imports.tooBig'));
                return;
            }
            // the scans first, one at a time (the server bounds what one person has waiting), then the sheet that names them
            const scanFileIds: string[] = [];
            setSent(0);
            for (const scan of scans) {
                scanFileIds.push((await uploadFile({ file: scan, documentType: 'paper_file_scan' })).file_id);
                setSent((n) => n + 1);
            }
            const batch = await create.mutateAsync({ filename: sheet.name, format, content, scanFileIds });
            router.push(`/competency/vehicle-imports/${batch.id}`);
        } catch (error) {
            notify.error(getApiErrorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex max-w-2xl flex-col gap-6" data-screen="vehicle-import-new">
            <PageHeader title={t('competency.imports.newTitle')} description={t('competency.imports.newIntro')} />
            <div className="flex flex-col gap-2">
                <p className="text-sm">{t('competency.imports.templateHint')}</p>
                <div>
                    <Button variant="outline" type="button" data-action="template" onClick={downloadTemplate}>
                        {t('competency.imports.template')}
                    </Button>
                </div>
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="import-sheet">{t('competency.imports.sheet')}</Label>
                <Input
                    id="import-sheet"
                    type="file"
                    accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => setSheet(e.target.files?.[0] ?? null)}
                />
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="import-scans">{t('competency.imports.scans')}</Label>
                <Input
                    id="import-scans"
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(e) => setScans([...(e.target.files ?? [])])}
                />
                <p className="text-muted-foreground text-sm">{t('competency.imports.scansHint')}</p>
            </div>
            <div className="flex items-center gap-4">
                <Button type="button" data-action="send" disabled={!sheet || busy} onClick={() => void submit()}>
                    {t('competency.imports.send')}
                </Button>
                {busy && scans.length > 0 && (
                    <span className="text-sm" data-scan-progress>
                        {t('competency.imports.uploading', { sent: String(sent), total: String(scans.length) })}
                    </span>
                )}
            </div>
        </div>
    );
}

function RowErrors({ row }: { row: VehicleImportRow }) {
    if (row.errors.length === 0) return null;
    return (
        <ul className="text-sm" data-row-errors>
            {row.errors.map((e, i) => (
                <li key={i} data-error-code={e.code} data-error-column={e.column ?? ''}>
                    {e.column ? <span className="font-mono">{e.column}</span> : null}
                    {e.column ? ': ' : null}
                    {e.message}
                </li>
            ))}
        </ul>
    );
}

function ScanButton({ row }: { row: VehicleImportRow }) {
    const { t } = useText();
    const notify = useNotify();
    if (!row.scan) return <span>—</span>;
    return (
        <Button
            variant="link"
            size="sm"
            data-action="scan"
            onClick={() =>
                void scanLink(row.id)
                    .then((url) => {
                        window.location.href = url;
                    })
                    .catch((error: unknown) => notify.error(getApiErrorMessage(error)))
            }
        >
            {row.scan.filename || t('competency.imports.scan')}
        </Button>
    );
}

export function VehicleImportReport({ id }: { id: string }) {
    const { t, language } = useText();
    const { calendar } = usePreferences();
    const notify = useNotify();
    const mayCreate = useCan('vehicle-import:create');
    const batch = useVehicleImport(id);
    const [state, setState] = useState<ImportRowState | 'all'>('all');
    const [offset, setOffset] = useState(0);
    const working = batch.data ? isWorking(batch.data.state) : false;
    const rows = useVehicleImportRows(id, state === 'all' ? undefined : state, offset, working);
    const commit = useCommitVehicleImport();
    const discard = useDiscardVehicleImport();

    if (batch.isPending) return <Skeleton className="h-40 w-full" />;
    if (batch.error)
        return (
            <EmptyState
                variant="error"
                title={t('competency.imports.error')}
                description={getApiErrorMessage(batch.error)}
            />
        );
    const b = batch.data;
    const mayDiscard = (b.state === 'checked' || b.state === 'failed') && (mayCreate || b.mayCommit);
    const total = rows.data?.total ?? 0;

    const act = async (what: 'commit' | 'discard') => {
        const ok = await confirmAction({
            message: t(what === 'commit' ? 'competency.imports.commitConfirm' : 'competency.imports.discardConfirm', {
                valid: String(b.counts.valid)
            }),
            danger: what === 'discard'
        });
        if (!ok) return;
        const mutation = what === 'commit' ? commit : discard;
        mutation.mutate(
            { id: b.id, version: b.version },
            { onError: (error) => notify.error(getApiErrorMessage(error)) }
        );
    };

    return (
        <div className="flex flex-col gap-6" data-screen="vehicle-import" data-state={b.state}>
            <PageHeader
                title={b.filename}
                description={t('competency.imports.reportIntro', {
                    name: b.createdBy.name,
                    when: formatMoment(b.createdAt, { language, calendar })
                })}
                actions={
                    <div className="flex gap-2">
                        {b.mayCommit && (
                            <Button data-action="commit" disabled={commit.isPending} onClick={() => void act('commit')}>
                                {t('competency.imports.commit', { valid: String(b.counts.valid) })}
                            </Button>
                        )}
                        {mayDiscard && (
                            <Button
                                variant="outline"
                                data-action="discard"
                                disabled={discard.isPending}
                                onClick={() => void act('discard')}
                            >
                                {t('competency.imports.discard')}
                            </Button>
                        )}
                    </div>
                }
            />
            <div className="flex flex-wrap items-center gap-4">
                <StatusBadge
                    value={b.state}
                    tone={STATE_TONE[b.state]}
                    label={t(`competency.imports.status.${b.state}`)}
                />
                <Counts batch={b} />
                <span className="text-sm" data-import-scans>
                    {t('competency.imports.scansUsed', { used: String(b.scans.used), given: String(b.scans.given) })}
                </span>
                {b.committedBy && (
                    <span className="text-sm" data-committed-by>
                        {t('competency.imports.committedBy', { name: b.committedBy.name })}
                    </span>
                )}
            </div>
            {b.state === 'checked' && !b.mayCommit && b.counts.valid > 0 && (
                <p className="text-sm" data-commit-hint>
                    {t('competency.imports.commitHint')}
                </p>
            )}
            {b.failure && (
                <EmptyState
                    variant="error"
                    title={t(`competency.imports.failure.${b.failure.code}`)}
                    description={b.failure.columns.join(', ')}
                />
            )}
            {working && <p className="text-sm">{t(`competency.imports.working.${b.state}`)}</p>}
            {!b.failure && (
                <>
                    <ToggleGroup
                        type="single"
                        variant="outline"
                        value={state}
                        onValueChange={(v) => {
                            if (!v) return;
                            setState(v as ImportRowState | 'all');
                            setOffset(0);
                        }}
                    >
                        <ToggleGroupItem value="all">{t('competency.imports.rowsAll')}</ToggleGroupItem>
                        {IMPORT_ROW_STATES.map((s) => (
                            <ToggleGroupItem key={s} value={s} data-filter={s}>
                                {t(`competency.imports.rowStatus.${s}`)}
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                    {rows.isPending ? (
                        <Skeleton className="h-40 w-full" />
                    ) : (rows.data?.items.length ?? 0) === 0 ? (
                        <EmptyState title={t('competency.imports.noRows')} />
                    ) : (
                        <Table data-import-rows>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('competency.imports.line')}</TableHead>
                                    <TableHead>{t('competency.imports.state')}</TableHead>
                                    <TableHead>{t('competency.imports.paperReference')}</TableHead>
                                    <TableHead>{t('competency.imports.vehicle')}</TableHead>
                                    <TableHead>{t('competency.imports.owner')}</TableHead>
                                    <TableHead>{t('competency.imports.errors')}</TableHead>
                                    <TableHead>{t('competency.imports.scan')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.data?.items.map((r) => (
                                    <TableRow
                                        key={r.id}
                                        id={`row-${r.id}`}
                                        data-row-line={r.line}
                                        data-row-state={r.state}
                                    >
                                        <TableCell>{r.line}</TableCell>
                                        <TableCell>
                                            <StatusBadge
                                                value={r.state}
                                                tone={ROW_TONE[r.state]}
                                                label={t(`competency.imports.rowStatus.${r.state}`)}
                                            />
                                        </TableCell>
                                        <TableCell>{r.paperReference ?? '—'}</TableCell>
                                        <TableCell>
                                            {r.vehicleId ? (
                                                <Link className="underline" href={`/registry/vehicles/${r.vehicleId}`}>
                                                    {r.plate ?? r.chassisNumber}
                                                </Link>
                                            ) : (
                                                [r.plate, r.chassisNumber, r.make, r.model]
                                                    .filter(Boolean)
                                                    .join(' · ') || '—'
                                            )}
                                        </TableCell>
                                        <TableCell>{r.owner ?? '—'}</TableCell>
                                        <TableCell>
                                            <RowErrors row={r} />
                                        </TableCell>
                                        <TableCell>
                                            <ScanButton row={r} />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                    {total > ROWS_PAGE && (
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={offset === 0}
                                onClick={() => setOffset(Math.max(0, offset - ROWS_PAGE))}
                            >
                                {t('competency.imports.previous')}
                            </Button>
                            <span className="text-sm">
                                {t('competency.imports.page', {
                                    from: String(offset + 1),
                                    to: String(Math.min(offset + ROWS_PAGE, total)),
                                    total: String(total)
                                })}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={offset + ROWS_PAGE >= total}
                                onClick={() => setOffset(offset + ROWS_PAGE)}
                            >
                                {t('competency.imports.next')}
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/** One imported row, as the vehicle record links to it: its paper file's facts, its scan, and its sheet. */
export function VehicleImportRowPage({ rowId }: { rowId: string }) {
    const { t } = useText();
    const row = useVehicleImportRow(rowId);
    if (row.isPending) return <Skeleton className="h-40 w-full" />;
    if (row.error)
        return (
            <EmptyState
                variant="error"
                title={t('competency.imports.error')}
                description={getApiErrorMessage(row.error)}
            />
        );
    const r = row.data;
    return (
        <div className="flex flex-col gap-4" data-screen="vehicle-import-row" data-row-state={r.state}>
            <PageHeader
                title={t('competency.imports.rowTitle', { line: String(r.line), reference: r.paperReference ?? '' })}
                actions={
                    <Button variant="outline" asChild>
                        <Link href={`/competency/vehicle-imports/${r.importId}`}>
                            {t('competency.imports.openSheet')}
                        </Link>
                    </Button>
                }
            />
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt>{t('competency.imports.state')}</dt>
                <dd>{t(`competency.imports.rowStatus.${r.state}`)}</dd>
                <dt>{t('competency.imports.vehicle')}</dt>
                <dd>{[r.plate, r.chassisNumber, r.make, r.model].filter(Boolean).join(' · ')}</dd>
                <dt>{t('competency.imports.owner')}</dt>
                <dd>{r.owner ?? '—'}</dd>
                <dt>{t('competency.imports.scan')}</dt>
                <dd>
                    <ScanButton row={r} />
                </dd>
            </dl>
            <RowErrors row={r} />
        </div>
    );
}
