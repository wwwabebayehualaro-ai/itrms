'use client';

/**
 * The competency menu's screens (task 0.24c): the requests of the two licence services and the exams waiting, which are the platform's
 * own requests list narrowed; and the registry views, the only service-specific UI there is. A licence changes only through its case.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useLookupSearch } from '@itrms/form-engine/renderer';
import {
    Button,
    Combobox,
    EmptyState,
    Input,
    Label,
    PageHeader,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
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
    type Tone
} from '@itrms/ui';
import {
    addisDay,
    LICENCE_STATUSES,
    type BATCH_STATUSES,
    type ENROLMENT_STATUSES,
    type LicenceStatus
} from '@itrms/competency/contracts';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import {
    LIST_LIMIT,
    useCompleteEnrolment,
    useEnrol,
    useEnrolments,
    useGrades,
    useLicences,
    usePrintBatches,
    useRecordPrinted,
    useSendPrintBatch,
    type Licence,
    type PrintBatch
} from '@/lib/competency';
import { formatDay } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { useServices } from '@/lib/services';
import { Requests } from '@/screens/workflow/Requests';

const nameOf = (name: { given: string; father: string; grandfather: string | null } | null | undefined): string =>
    name ? [name.given, name.father, name.grandfather].filter(Boolean).join(' ') : '';

function Choice<T extends string>({
    label,
    value,
    options,
    onChange
}: {
    label: string;
    value: T;
    options: readonly { value: T; label: string }[];
    onChange: (value: T) => void;
}) {
    return (
        <ToggleGroup
            type="single"
            variant="outline"
            value={value}
            aria-label={label}
            onValueChange={(v) => v && onChange(v as T)}
        >
            {options.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value} data-choice={o.value}>
                    {o.label}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
}

/** A list stops at what the API gives at once, and says so: anyone older is found by narrowing it. */
function MoreHint({ shown }: { shown: number }) {
    const { t } = useText();
    if (shown < LIST_LIMIT) return null;
    return (
        <p className="text-sm text-muted-foreground" data-more>
            {t('competency.list.more', { count: String(LIST_LIMIT) })}
        </p>
    );
}

const LICENCE_SERVICES = ['DVC-03', 'DVC-04'] as const;
type LicenceService = (typeof LICENCE_SERVICES)[number];

/** The licence services this office offers, of the two: a unit may offer only some. */
function useOfferedLicenceServices(): LicenceService[] | null {
    const services = useServices();
    if (!services.data) return null;
    const offered = services.data.filter((s) => s.enabled && s.configured).map((s) => s.code);
    return LICENCE_SERVICES.filter((code) => offered.includes(code));
}

export function LicenceApplications() {
    const { t } = useText();
    const offered = useOfferedLicenceServices();
    const mayFile = useCan('case:create');
    const [chosen, setChosen] = useState<LicenceService | undefined>();
    if (offered === null) return <Skeleton className="h-40 w-full" />;
    const service = chosen && offered.includes(chosen) ? chosen : offered[0];
    if (!service)
        return (
            <EmptyState
                title={t('competency.applications.noneOffered')}
                description={t('competency.applications.noneOfferedHint')}
            />
        );
    const labels: Record<LicenceService, string> = {
        'DVC-03': t('competency.applications.new'),
        'DVC-04': t('competency.applications.renewal')
    };
    return (
        <Requests
            key={service}
            fixed={{ service }}
            title={t('competency.applications.title')}
            intro={t('competency.applications.intro')}
            toolbar={
                <div className="flex flex-wrap items-center gap-2" data-applications>
                    {offered.length > 1 && (
                        <Choice
                            label={t('competency.applications.service')}
                            value={service}
                            options={offered.map((code) => ({ value: code, label: labels[code] }))}
                            onChange={setChosen}
                        />
                    )}
                    {mayFile && (
                        <Button asChild>
                            <Link
                                href={
                                    service === 'DVC-03'
                                        ? '/competency/applications/new'
                                        : '/competency/applications/renew'
                                }
                            >
                                {t(
                                    service === 'DVC-03'
                                        ? 'competency.applications.fileNew'
                                        : 'competency.applications.fileRenewal'
                                )}
                            </Link>
                        </Button>
                    )}
                </div>
            }
        />
    );
}

/** The cases waiting for their exam: the first exam of a new licence, or the practical of a late renewal. */
export function LicenceExams() {
    const { t } = useText();
    const [which, setWhich] = useState<'new' | 'late'>('new');
    return (
        <Requests
            key={which}
            fixed={which === 'new' ? { service: 'DVC-03', state: 'exam' } : { service: 'DVC-04', state: 'field_exam' }}
            title={t('competency.exams.title')}
            intro={t('competency.exams.intro')}
            toolbar={
                <Choice
                    label={t('competency.exams.which')}
                    value={which}
                    options={[
                        { value: 'new', label: t('competency.exams.new') },
                        { value: 'late', label: t('competency.exams.late') }
                    ]}
                    onChange={setWhich}
                />
            }
        />
    );
}

/** A person or a school, found through the same lookups a form's fields use. What was picked stays shown, whatever is searched next. */
function Picker({
    provider,
    label,
    value,
    onChange
}: {
    provider: 'person' | 'training-school';
    label: string;
    value: string | null;
    onChange: (id: string | null) => void;
}) {
    const { t } = useText();
    const [search, setSearch] = useState('');
    const [picked, setPicked] = useState<string | undefined>();
    const found = useLookupSearch(provider, search);
    return (
        <div className="flex flex-col gap-1.5">
            <Label>{label}</Label>
            <Combobox
                aria-label={label}
                className="w-64"
                options={found.items.map((i) => ({ value: i.id, label: i.label }))}
                value={value}
                fallbackLabel={value ? picked : undefined}
                clearable
                clearLabel={t('competency.training.clear')}
                onChange={(id) => {
                    setPicked(found.items.find((i) => i.id === id)?.label);
                    onChange(typeof id === 'string' ? id : null);
                }}
                onSearchChange={setSearch}
                placeholder={t('competency.training.pick')}
                searchPlaceholder={t('competency.training.search')}
                emptyMessage={t(
                    found.failed
                        ? 'competency.training.lookupFailed'
                        : found.tooShort
                          ? 'competency.training.tooShort'
                          : found.searching
                            ? 'competency.training.searching'
                            : 'competency.training.noneFound'
                )}
            />
        </div>
    );
}

const STATUS_TONE: Record<LicenceStatus, Tone> = {
    active: 'success',
    pending_national: 'warning',
    voided: 'neutral'
};

function LicenceRow({ licence }: { licence: Licence }) {
    const { t, text, language } = useText();
    const { calendar } = usePreferences();
    const holder = (language === 'en' ? licence.holder.en : licence.holder.am) ?? licence.holder.am;
    const expired = licence.status === 'active' && !!licence.validUntil && licence.validUntil < addisDay();
    return (
        <TableRow data-licence={licence.id} data-status={licence.status} data-kind={licence.kind}>
            <TableCell className="font-medium" data-licence-number>
                {licence.number ?? '—'}
            </TableCell>
            <TableCell>
                <Link className="underline" href={`/registry/persons/${licence.personId}`}>
                    {nameOf(holder)}
                </Link>
            </TableCell>
            <TableCell>{licence.grades.map((g) => text(g.name)).join(', ')}</TableCell>
            <TableCell>
                <div className="flex flex-wrap gap-1">
                    <StatusBadge
                        value={licence.status}
                        tone={STATUS_TONE[licence.status]}
                        label={t(`competency.licence.status.${licence.status}`)}
                    />
                    {licence.status === 'active' && (
                        <StatusBadge
                            value={licence.kind}
                            tone="info"
                            label={t(`competency.licence.kind.${licence.kind}`)}
                        />
                    )}
                    {expired && <StatusBadge value="expired" tone="danger" label={t('competency.licence.expired')} />}
                </div>
            </TableCell>
            <TableCell data-valid-until={licence.validUntil ?? ''}>
                {formatDay(licence.validUntil, { language, calendar })}
            </TableCell>
            <TableCell>{text(licence.handlingUnit.name)}</TableCell>
            <TableCell>
                {licence.caseId && (
                    <Link className="underline" href={`/cases/${licence.caseId}`}>
                        {t('competency.licence.case')}
                    </Link>
                )}
            </TableCell>
        </TableRow>
    );
}

const ALL = 'all';

export function LicenceRegister() {
    const { t } = useText();
    const [typed, setTyped] = useState('');
    const [number, setNumber] = useState<string | undefined>();
    const [holder, setHolder] = useState<string | null>(null);
    const [status, setStatus] = useState<LicenceStatus | typeof ALL>(ALL);
    const licences = useLicences({
        ...(number ? { number } : {}),
        ...(holder ? { personId: holder } : {}),
        ...(status === ALL ? {} : { status })
    });
    const items = licences.data?.items ?? [];
    return (
        <div className="flex flex-col gap-6" data-screen="licences">
            <PageHeader title={t('competency.licences.title')} description={t('competency.licences.intro')} />
            <form
                role="search"
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    setNumber(typed.trim() || undefined);
                }}
            >
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="licence-number">{t('competency.licences.number')}</Label>
                    <Input
                        id="licence-number"
                        className="w-56"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                    />
                </div>
                <Picker provider="person" label={t('competency.licences.holder')} value={holder} onChange={setHolder} />
                <Select value={status} onValueChange={(v) => setStatus(v as LicenceStatus | typeof ALL)}>
                    <SelectTrigger className="w-48" aria-label={t('competency.licences.status')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>{t('competency.licences.anyStatus')}</SelectItem>
                        {LICENCE_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                                {t(`competency.licence.status.${s}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button type="submit" variant="outline">
                    {t('competency.licences.find')}
                </Button>
            </form>
            {licences.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : licences.error ? (
                <EmptyState
                    variant="error"
                    title={t('competency.licences.error')}
                    description={getApiErrorMessage(licences.error)}
                />
            ) : items.length === 0 ? (
                <EmptyState title={t('competency.licences.empty')} description={t('competency.licences.emptyHint')} />
            ) : (
                <>
                    <Table data-licences>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('competency.licences.number')}</TableHead>
                                <TableHead>{t('competency.licences.holder')}</TableHead>
                                <TableHead>{t('competency.licences.grades')}</TableHead>
                                <TableHead>{t('competency.licences.status')}</TableHead>
                                <TableHead>{t('competency.licences.validUntil')}</TableHead>
                                <TableHead>{t('competency.licences.office')}</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((l) => (
                                <LicenceRow key={l.id} licence={l} />
                            ))}
                        </TableBody>
                    </Table>
                    <MoreHint shown={items.length} />
                </>
            )}
        </div>
    );
}

/** A school's list of who finished training, entered by the office: an application is refused until the applicant is on it. */
export function TrainingLists() {
    const { t, text, language } = useText();
    const { calendar } = usePreferences();
    const mayRecord = useCan('training:record');
    const [person, setPerson] = useState<string | null>(null);
    const [school, setSchool] = useState<string | null>(null);
    const [grade, setGrade] = useState<string | undefined>();
    const [show, setShow] = useState<(typeof ENROLMENT_STATUSES)[number] | typeof ALL>(ALL);
    // whoever is picked narrows the list too: someone enrolled long ago is found the same way they are added
    const list = useEnrolments({ ...(person ? { personId: person } : {}), ...(show === ALL ? {} : { status: show }) });
    const grades = useGrades(mayRecord);
    const enrol = useEnrol();
    const complete = useCompleteEnrolment();
    const items = list.data?.items ?? [];
    return (
        <div className="flex flex-col gap-6" data-screen="training">
            <PageHeader title={t('competency.training.title')} description={t('competency.training.intro')} />
            <form
                className="flex flex-wrap items-end gap-3"
                data-enrol
                onSubmit={(e) => {
                    e.preventDefault();
                    if (!person || !school || !grade) return;
                    enrol.mutate(
                        { personId: person, schoolId: school, grade },
                        { onSuccess: () => setGrade(undefined) }
                    );
                }}
            >
                <Picker provider="person" label={t('competency.training.person')} value={person} onChange={setPerson} />
                {mayRecord && (
                    <>
                        <Picker
                            provider="training-school"
                            label={t('competency.training.school')}
                            value={school}
                            onChange={setSchool}
                        />
                        <Select value={grade ?? ''} onValueChange={setGrade}>
                            <SelectTrigger className="w-56" aria-label={t('competency.training.grade')}>
                                <SelectValue placeholder={t('competency.training.grade')} />
                            </SelectTrigger>
                            <SelectContent>
                                {(grades.data?.items ?? [])
                                    .filter((g) => g.active)
                                    .map((g) => (
                                        <SelectItem key={g.key} value={g.key}>
                                            {text(g.name)}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                        <Button type="submit" disabled={!person || !school || !grade || enrol.isPending}>
                            {t('competency.training.add')}
                        </Button>
                    </>
                )}
                <Choice
                    label={t('competency.training.show')}
                    value={show}
                    options={[
                        { value: ALL, label: t('competency.training.showAll') },
                        { value: 'enrolled', label: t('competency.training.showUnfinished') }
                    ]}
                    onChange={setShow}
                />
            </form>
            {list.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : list.error ? (
                <EmptyState
                    variant="error"
                    title={t('competency.training.error')}
                    description={getApiErrorMessage(list.error)}
                />
            ) : items.length === 0 ? (
                <EmptyState title={t('competency.training.empty')} description={t('competency.training.emptyHint')} />
            ) : (
                <>
                    <Table data-enrolments>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('competency.training.person')}</TableHead>
                                <TableHead>{t('competency.training.school')}</TableHead>
                                <TableHead>{t('competency.training.grade')}</TableHead>
                                <TableHead>{t('competency.training.completedOn')}</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((e) => (
                                <TableRow
                                    key={e.id}
                                    data-enrolment={e.id}
                                    data-person={e.personId}
                                    data-status={e.status}
                                >
                                    <TableCell>
                                        {(language === 'en' ? e.personName.en : e.personName.am) ?? e.personName.am}
                                    </TableCell>
                                    <TableCell>{text(e.schoolName)}</TableCell>
                                    <TableCell>{text(e.gradeName)}</TableCell>
                                    <TableCell>{formatDay(e.completedOn, { language, calendar })}</TableCell>
                                    <TableCell>
                                        {mayRecord && e.status === 'enrolled' && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                data-action="complete"
                                                disabled={complete.isPending}
                                                onClick={() =>
                                                    complete.mutate({
                                                        id: e.id,
                                                        version: e.version,
                                                        completedOn: addisDay()
                                                    })
                                                }
                                            >
                                                {t('competency.training.complete')}
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <MoreHint shown={items.length} />
                </>
            )}
        </div>
    );
}

const BATCH_TONE: Record<(typeof BATCH_STATUSES)[number], Tone> = {
    open: 'info',
    requested: 'warning',
    sent: 'success',
    returned: 'warning',
    distributed: 'success'
};

/** A sent batch back from the printer: the first card blank it was printed on (the rest follow in order). */
function RecordPrinted({ batch }: { batch: PrintBatch }) {
    const { t } = useText();
    const printed = useRecordPrinted();
    const [first, setFirst] = useState('');
    return (
        <div className="flex flex-col items-end gap-1" data-record-printed={batch.id}>
            <div className="flex items-center gap-2">
                <Input
                    aria-label={t('competency.batches.firstCard')}
                    placeholder={t('competency.batches.firstCard')}
                    className="h-8 w-36"
                    value={first}
                    onChange={(e) => setFirst(e.target.value)}
                />
                <Button
                    size="sm"
                    data-action="printed"
                    disabled={printed.isPending || first.trim() === ''}
                    onClick={() => printed.mutate({ id: batch.id, version: batch.version, firstCardKey: first.trim() })}
                >
                    {t('competency.batches.printed')}
                </Button>
            </div>
            {printed.error && (
                <span className="text-destructive text-xs" data-problem>
                    {getApiErrorMessage(printed.error, t('competency.batches.printedFailed'))}
                </span>
            )}
        </div>
    );
}

/** What the office has for the region's printer: a batch goes once, and the national platform names it. */
export function PrintBatches() {
    const { t, language } = useText();
    const { calendar } = usePreferences();
    const list = usePrintBatches();
    const send = useSendPrintBatch();
    const items = list.data?.items ?? [];
    return (
        <div className="flex flex-col gap-6" data-screen="print-batches">
            <PageHeader title={t('competency.batches.title')} description={t('competency.batches.intro')} />
            {list.isPending ? (
                <Skeleton className="h-40 w-full" />
            ) : list.error ? (
                <EmptyState
                    variant="error"
                    title={t('competency.batches.error')}
                    description={getApiErrorMessage(list.error)}
                />
            ) : items.length === 0 ? (
                <EmptyState title={t('competency.batches.empty')} description={t('competency.batches.emptyHint')} />
            ) : (
                <Table data-batches>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('competency.batches.opened')}</TableHead>
                            <TableHead>{t('competency.batches.licences')}</TableHead>
                            <TableHead>{t('competency.batches.status')}</TableHead>
                            <TableHead>{t('competency.batches.reference')}</TableHead>
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((b) => (
                            <TableRow key={b.id} data-batch={b.id} data-status={b.status}>
                                <TableCell>{formatDay(b.createdAt, { language, calendar })}</TableCell>
                                <TableCell data-batch-licences>{b.licences}</TableCell>
                                <TableCell>
                                    <StatusBadge
                                        value={b.status}
                                        tone={BATCH_TONE[b.status]}
                                        label={t(`competency.batch.status.${b.status}`)}
                                    />
                                </TableCell>
                                <TableCell>{b.nationalReference ?? '—'}</TableCell>
                                <TableCell>
                                    {b.status === 'open' && (
                                        <Button
                                            size="sm"
                                            data-action="send"
                                            disabled={send.isPending}
                                            onClick={() => send.mutate({ id: b.id, version: b.version })}
                                        >
                                            {t('competency.batches.send')}
                                        </Button>
                                    )}
                                    {b.status === 'sent' && <RecordPrinted batch={b} />}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
