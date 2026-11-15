'use client';

/**
 * Sampling QA of migrated vehicles (ADR-0054 §3, task 1.13g). A set share of each clerk's migrated records is drawn for a
 * re-check against the scan by someone who is neither the clerk nor the second person who verified it; the facts found wrong are
 * counted per clerk. A re-check measures: it never changes the record.
 */
import Link from 'next/link';
import { useState } from 'react';
import {
    Button,
    Checkbox,
    EmptyState,
    Label,
    PageHeader,
    RadioGroup,
    RadioGroupItem,
    Skeleton,
    StatusBadge,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Tabs,
    TabsList,
    TabsTrigger,
    Textarea,
    useNotify,
    type Tone
} from '@itrms/ui';
import {
    migrationSampleRecheckSchema,
    SAMPLE_FIELDS,
    type SampleField,
    type SampleOutcome,
    type SampleSource,
    type SampleState
} from '@itrms/competency/contracts';

import { getApiErrorMessage } from '@/lib/api/errors';
import { formatMoment } from '@/lib/format';
import {
    SAMPLES_PAGE,
    useClerkCounts,
    useMigrationSample,
    useMigrationSamples,
    useRecheckSample,
    useSampleScanLink,
    type MigrationSample as Sample
} from '@/lib/migration-samples';
import { usePreferences, useText } from '@/lib/preferences';

const STATE_TONE: Record<SampleState, Tone> = { drawn: 'progress', rechecked: 'success' };
const NOTE_MAX = 500;

type Tab = SampleState | 'clerks';

function SampleList({ state }: { state: SampleState }) {
    const { t, text, language } = useText();
    const { calendar } = usePreferences();
    const [offset, setOffset] = useState(0);
    const list = useMigrationSamples(state, offset);
    if (list.isPending) return <Skeleton className="h-40 w-full" />;
    if (list.error)
        return (
            <EmptyState
                variant="error"
                title={t('competency.samples.error')}
                description={getApiErrorMessage(list.error)}
            />
        );
    const { items, total } = list.data;
    if (items.length === 0) return <EmptyState title={t(`competency.samples.empty.${state}`)} />;
    return (
        <>
            <Table data-samples>
                <TableHeader>
                    <TableRow>
                        <TableHead>{t('competency.samples.plate')}</TableHead>
                        <TableHead>{t('competency.samples.chassisNumber')}</TableHead>
                        <TableHead>{t('competency.samples.paperReference')}</TableHead>
                        <TableHead>{t('competency.samples.sourceHead')}</TableHead>
                        <TableHead>{t('competency.samples.clerk')}</TableHead>
                        <TableHead>{t('competency.samples.office')}</TableHead>
                        <TableHead>{t('competency.samples.drawnAt')}</TableHead>
                        <TableHead>{t('competency.samples.state')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((s) => (
                        <TableRow key={s.id} data-sample-row data-sample={s.id} data-state={s.state}>
                            <TableCell>
                                <Link className="underline" href={`/competency/migration-samples/${s.id}`}>
                                    {s.vehicle.plate ?? t('competency.samples.noPlate')}
                                </Link>
                            </TableCell>
                            <TableCell>{s.vehicle.chassisNumber}</TableCell>
                            <TableCell>{s.vehicle.paperReference ?? '—'}</TableCell>
                            <TableCell>{t(`competency.samples.source.${s.source}`)}</TableCell>
                            <TableCell>{s.clerk.name}</TableCell>
                            <TableCell>{text({ am: '', en: '', ...s.unit.name })}</TableCell>
                            <TableCell>{formatMoment(s.drawnAt, { language, calendar })}</TableCell>
                            <TableCell>
                                <StatusBadge
                                    value={s.state}
                                    tone={STATE_TONE[s.state]}
                                    label={t(`competency.samples.status.${s.state}`)}
                                />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {total > SAMPLES_PAGE && (
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - SAMPLES_PAGE))}
                    >
                        {t('competency.imports.previous')}
                    </Button>
                    <span className="text-sm">
                        {t('competency.imports.page', {
                            from: String(offset + 1),
                            to: String(Math.min(offset + SAMPLES_PAGE, total)),
                            total: String(total)
                        })}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={offset + SAMPLES_PAGE >= total}
                        onClick={() => setOffset(offset + SAMPLES_PAGE)}
                    >
                        {t('competency.imports.next')}
                    </Button>
                </div>
            )}
        </>
    );
}

function ClerkTable() {
    const { t, text } = useText();
    const clerks = useClerkCounts();
    if (clerks.isPending) return <Skeleton className="h-40 w-full" />;
    if (clerks.error)
        return (
            <EmptyState
                variant="error"
                title={t('competency.samples.error')}
                description={getApiErrorMessage(clerks.error)}
            />
        );
    const items = clerks.data.items;
    if (items.length === 0) return <EmptyState title={t('competency.samples.empty.clerks')} />;
    return (
        <Table data-clerks>
            <TableHeader>
                <TableRow>
                    <TableHead>{t('competency.samples.office')}</TableHead>
                    <TableHead>{t('competency.samples.clerk')}</TableHead>
                    <TableHead>{t('competency.samples.records')}</TableHead>
                    <TableHead>{t('competency.samples.drawn')}</TableHead>
                    <TableHead>{t('competency.samples.rechecked')}</TableHead>
                    <TableHead>{t('competency.samples.withErrors')}</TableHead>
                    <TableHead>{t('competency.samples.errors')}</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {items.map((c) => (
                    <TableRow key={`${c.unit.id}-${c.clerk.id}`} data-clerk-row={c.clerk.id}>
                        <TableCell>{text({ am: '', en: '', ...c.unit.name })}</TableCell>
                        <TableCell>{c.clerk.name}</TableCell>
                        <TableCell data-count="records">{c.records}</TableCell>
                        <TableCell data-count="drawn">{c.drawn}</TableCell>
                        <TableCell data-count="rechecked">{c.rechecked}</TableCell>
                        <TableCell data-count="withErrors">{c.withErrors}</TableCell>
                        <TableCell data-count="errors">{c.errors}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export function MigrationSamples() {
    const { t } = useText();
    const [tab, setTab] = useState<Tab>('drawn');
    return (
        <div className="flex flex-col gap-6" data-screen="migration-samples">
            <PageHeader title={t('competency.samples.title')} description={t('competency.samples.intro')} />
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
                <TabsList>
                    <TabsTrigger value="drawn" data-tab="drawn">
                        {t('competency.samples.tab.drawn')}
                    </TabsTrigger>
                    <TabsTrigger value="rechecked" data-tab="rechecked">
                        {t('competency.samples.tab.rechecked')}
                    </TabsTrigger>
                    <TabsTrigger value="clerks" data-tab="clerks">
                        {t('competency.samples.tab.clerks')}
                    </TabsTrigger>
                </TabsList>
            </Tabs>
            {tab === 'clerks' ? <ClerkTable /> : <SampleList key={tab} state={tab} />}
        </div>
    );
}

function ScanButton({ id, fileId, filename }: { id: string; fileId: string; filename: string }) {
    const { t } = useText();
    const notify = useNotify();
    const link = useSampleScanLink();
    return (
        <Button
            variant="outline"
            size="sm"
            data-action="scan"
            disabled={link.isPending}
            onClick={() =>
                link.mutate(
                    { id, fileId },
                    {
                        onSuccess: (url) => window.open(url, '_blank', 'noopener'),
                        onError: (error) => notify.error(getApiErrorMessage(error))
                    }
                )
            }
        >
            {filename || t('competency.samples.openScan')}
        </Button>
    );
}

function RecheckForm({ sample }: { sample: Sample }) {
    const { t } = useText();
    const notify = useNotify();
    const recheck = useRecheckSample(sample.id);
    const [outcome, setOutcome] = useState<SampleOutcome | null>(null);
    const [fields, setFields] = useState<SampleField[]>([]);
    const [note, setNote] = useState('');

    const parsed = outcome
        ? migrationSampleRecheckSchema.safeParse({
              outcome,
              fields: outcome === 'errors' ? fields : [],
              ...(note.trim() ? { note } : {})
          })
        : null;
    const toggle = (field: SampleField, on: boolean) =>
        setFields((now) => (on ? [...now.filter((f) => f !== field), field] : now.filter((f) => f !== field)));

    return (
        <form
            className="flex max-w-2xl flex-col gap-4"
            data-recheck-form
            onSubmit={(e) => {
                e.preventDefault();
                if (!parsed?.success) return;
                recheck.mutate(
                    { version: sample.version, recheck: parsed.data },
                    { onError: (error) => notify.error(getApiErrorMessage(error)) }
                );
            }}
        >
            <h2 className="text-lg font-medium">{t('competency.samples.recheckTitle')}</h2>
            <RadioGroup value={outcome ?? ''} onValueChange={(v) => setOutcome(v as SampleOutcome)}>
                {(['correct', 'errors'] as const).map((o) => (
                    <div key={o} className="flex items-center gap-2">
                        <RadioGroupItem id={`outcome-${o}`} value={o} data-outcome={o} />
                        <Label htmlFor={`outcome-${o}`}>{t(`competency.samples.outcome.${o}`)}</Label>
                    </div>
                ))}
            </RadioGroup>
            {outcome === 'errors' && (
                <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">{t('competency.samples.fieldsLegend')}</legend>
                    {SAMPLE_FIELDS.map((f) => (
                        <div key={f} className="flex items-center gap-2">
                            <Checkbox
                                id={`field-${f}`}
                                data-field={f}
                                checked={fields.includes(f)}
                                onCheckedChange={(on) => toggle(f, on === true)}
                            />
                            <Label htmlFor={`field-${f}`}>{t(`competency.sample.field.${f}`)}</Label>
                        </div>
                    ))}
                </fieldset>
            )}
            <div className="flex flex-col gap-2">
                <Label htmlFor="sample-note">{t('competency.samples.note')}</Label>
                <Textarea
                    id="sample-note"
                    data-field="note"
                    maxLength={NOTE_MAX}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
            </div>
            <div>
                <Button type="submit" data-action="recheck" disabled={!parsed?.success || recheck.isPending}>
                    {t('competency.samples.save')}
                </Button>
            </div>
        </form>
    );
}

export function MigrationSample({ id }: { id: string }) {
    const { t, text, language } = useText();
    const { calendar } = usePreferences();
    const sample = useMigrationSample(id);
    if (sample.isPending) return <Skeleton className="h-40 w-full" />;
    if (sample.error)
        return (
            <EmptyState
                variant="error"
                title={t('competency.samples.error')}
                description={getApiErrorMessage(sample.error)}
            />
        );
    const s = sample.data;
    const source: SampleSource = s.source;
    return (
        <div className="flex flex-col gap-6" data-screen="migration-sample" data-state={s.state}>
            <PageHeader
                title={t('competency.samples.recordTitle', { plate: s.vehicle.plate ?? s.vehicle.chassisNumber })}
                actions={
                    <div className="flex gap-2">
                        {s.scans.map((f) => (
                            <ScanButton key={f.id} id={s.id} fileId={f.id} filename={f.filename} />
                        ))}
                        <Button variant="outline" asChild>
                            <Link href="/competency/migration-samples">{t('competency.samples.back')}</Link>
                        </Button>
                    </div>
                }
            />
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt>{t('competency.samples.plate')}</dt>
                <dd>
                    <Link className="underline" href={`/registry/vehicles/${s.vehicle.id}`} data-vehicle-link>
                        {s.vehicle.plate ?? t('competency.samples.noPlate')}
                    </Link>
                </dd>
                <dt>{t('competency.samples.chassisNumber')}</dt>
                <dd>{s.vehicle.chassisNumber}</dd>
                <dt>{t('competency.samples.paperReference')}</dt>
                <dd>{s.vehicle.paperReference ?? '—'}</dd>
                <dt>{t('competency.samples.sourceHead')}</dt>
                <dd>
                    {s.caseId || s.importRowId ? (
                        <Link
                            className="underline"
                            href={
                                s.caseId
                                    ? `/cases/${s.caseId}`
                                    : `/competency/vehicle-imports/rows/${s.importRowId ?? ''}`
                            }
                            data-source-link
                        >
                            {t(`competency.samples.source.${source}`)}
                        </Link>
                    ) : (
                        t(`competency.samples.source.${source}`)
                    )}
                </dd>
                <dt>{t('competency.samples.office')}</dt>
                <dd>{text({ am: '', en: '', ...s.unit.name })}</dd>
                <dt>{t('competency.samples.clerk')}</dt>
                <dd>{s.clerk.name}</dd>
                <dt>{t('competency.samples.verifier')}</dt>
                <dd>{s.verifier.name}</dd>
                <dt>{t('competency.samples.drawnAt')}</dt>
                <dd>{formatMoment(s.drawnAt, { language, calendar })}</dd>
                <dt>{t('competency.samples.share')}</dt>
                <dd>{t('competency.samples.sharePercent', { share: String(s.share) })}</dd>
                <dt>{t('competency.samples.state')}</dt>
                <dd>
                    <StatusBadge
                        value={s.state}
                        tone={STATE_TONE[s.state]}
                        label={t(`competency.samples.status.${s.state}`)}
                    />
                </dd>
            </dl>
            {s.mayRecheck && <RecheckForm sample={s} />}
            {s.state === 'rechecked' && s.outcome && (
                <div className="flex flex-col gap-2 text-sm" data-recheck-result data-outcome={s.outcome}>
                    <h2 className="text-lg font-medium">{t('competency.samples.recheckTitle')}</h2>
                    <p>{t(`competency.samples.outcome.${s.outcome}`)}</p>
                    {s.errorFields.length > 0 && (
                        <ul className="list-disc ps-5" data-error-fields>
                            {s.errorFields.map((f) => (
                                <li key={f} data-field={f}>
                                    {t(`competency.sample.field.${f}`)}
                                </li>
                            ))}
                        </ul>
                    )}
                    {s.note && <p data-note>{s.note}</p>}
                    {s.recheckedBy && s.recheckedAt && (
                        <p className="text-muted-foreground">
                            {t('competency.samples.recheckedBy', {
                                name: s.recheckedBy.name,
                                when: formatMoment(s.recheckedAt, { language, calendar })
                            })}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
