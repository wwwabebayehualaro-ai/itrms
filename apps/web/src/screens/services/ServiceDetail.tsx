'use client';

/**
 * One service (task 0.21c): its versions; publishing a new one (a seat at the region: the region's own workflow and
 * request form, what offices below may change, from which day); and an office's configuration: each value with where
 * it comes from, and the office's own changes, made from the office above it (an office never changes its own). The API
 * checks the seat, the policy, the version read (If-Match) and that each value fits the version.
 */
import { useState } from 'react';
import {
    Badge,
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    EthiopianDatePicker,
    Input,
    Label,
    PageHeader,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Textarea,
    confirmAction,
    useNotify
} from '@itrms/ui';

import { isApiError } from '@/lib/api/client';
import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { formatDay } from '@/lib/format';
import { formLanguages, usePreferences, useText } from '@/lib/preferences';
import { LANGUAGE_ENDONYMS } from '@itrms/schemas';
import {
    OVERRIDE_FAMILIES,
    OVERRIDE_LEVELS,
    useChangeOverride,
    usePublishedForms,
    usePublishVersion,
    useServiceConfiguration,
    useServices,
    useServiceVersions,
    useWorkflows,
    type OverrideConflict,
    type OverrideFamily,
    type OverrideLevel,
    type ServiceConfiguration,
    type Sla,
    type Source
} from '@/lib/services';
import { useSubtree } from '@/lib/settings';

type Text = Readonly<Partial<Record<string, string>>>;
const NO_FORM = '-';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

function useDateLabels() {
    const { t } = useText();
    return {
        placeholder: t('parties.form.pickDate'),
        previousMonth: t('parties.form.previousMonth'),
        nextMonth: t('parties.form.nextMonth'),
        clear: t('parties.form.clear'),
        month: t('parties.form.month'),
        year: t('parties.form.year')
    };
}

function Versions({ code }: { code: string }) {
    const { t, language } = useText();
    const { calendar } = usePreferences();
    const versions = useServiceVersions(code);
    if (!versions.data?.length)
        return <p className="text-sm text-muted-foreground">{t('services.service.noVersions')}</p>;
    return (
        <ul className="flex flex-col gap-1 text-sm" data-versions>
            {versions.data.map((v) => (
                <li key={v.id} data-version={v.number}>
                    <span className="font-medium">{t('services.service.version', { number: String(v.number) })}</span>
                    {' · '}
                    {t('services.service.from', { date: formatDay(v.effectiveFrom, { language, calendar }) })}
                </li>
            ))}
        </ul>
    );
}

function Conflicts({ conflicts }: { conflicts: OverrideConflict[] }) {
    const { t, text } = useText();
    if (!conflicts.length) return null;
    return (
        <div className="flex flex-col gap-1 text-sm" data-conflicts>
            <p>{t('services.publish.conflicts')}</p>
            <ul className="list-disc ps-5">
                {conflicts.map((c) => (
                    <li key={`${c.unitId}:${c.key}`}>
                        {text(c.unitName)} · <span className="font-mono text-xs">{c.key}</span> ·{' '}
                        {t(`services.problem.${c.problem}`)}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Publish({ code }: { code: string }) {
    const { t, text, language } = useText();
    const notify = useNotify();
    const regionId = useAuthStore((s) => s.workspace?.activeUnit.regionId);
    const workflows = useWorkflows();
    const forms = usePublishedForms();
    const publish = usePublishVersion(code);
    const dateLabels = useDateLabels();
    // a version names the region's own workflow and form (other zones could not read a zone's)
    const ownWorkflows = (workflows.data ?? []).filter(
        (w) => w.active && w.latestVersion && w.ownerUnit.id === regionId
    );
    const ownForms = (forms.data ?? []).filter((f) => f.ownerUnit.id === regionId);
    const [workflowVersionId, setWorkflow] = useState<string>();
    const [formVersionId, setForm] = useState<string>(NO_FORM);
    const [policy, setPolicy] = useState<Partial<Record<OverrideFamily, OverrideLevel[]>>>({ sla: ['unit'] });
    const [effectiveFrom, setFrom] = useState<string | null>(null);
    const [conflicts, setConflicts] = useState<OverrideConflict[]>([]);

    const toggle = (family: OverrideFamily, level: OverrideLevel, on: boolean) =>
        setPolicy((p) => {
            const levels = new Set(p[family] ?? []);
            if (on) levels.add(level);
            else levels.delete(level);
            return { ...p, [family]: OVERRIDE_LEVELS.filter((l) => levels.has(l)) };
        });

    const submit = async () => {
        if (!workflowVersionId) return;
        try {
            const out = await publish.mutateAsync({
                workflowVersionId,
                formVersionId: formVersionId === NO_FORM ? null : formVersionId,
                overridePolicy: Object.fromEntries(Object.entries(policy).filter(([, levels]) => levels?.length)),
                ...(effectiveFrom ? { effectiveFrom } : {})
            });
            setConflicts(out.conflicts);
            notify.success(t('services.publish.done', { number: String(out.version.number) }));
        } catch (error) {
            notify.error(getApiErrorMessage(error));
        }
    };

    return (
        <section className="flex flex-col gap-4 rounded-md border p-4" data-section="publish">
            <div>
                <h2 className="text-lg font-semibold">{t('services.publish.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('services.publish.intro')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <Label htmlFor="publish-workflow">{t('services.publish.workflow')}</Label>
                    <Select value={workflowVersionId} onValueChange={setWorkflow}>
                        <SelectTrigger id="publish-workflow" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {ownWorkflows.map((w) => (
                                <SelectItem key={w.id} value={w.latestVersion?.id ?? w.id}>
                                    {text(w.name)} ·{' '}
                                    {t('services.service.version', { number: String(w.latestVersion?.number ?? 0) })}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="publish-form">{t('services.publish.form')}</Label>
                    <Select value={formVersionId} onValueChange={setForm}>
                        <SelectTrigger id="publish-form" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NO_FORM}>{t('services.publish.noForm')}</SelectItem>
                            {ownForms.map((f) => (
                                <SelectItem key={f.id} value={f.publishedVersion?.id ?? f.id}>
                                    {text(f.name)} ·{' '}
                                    {t('services.service.version', { number: String(f.publishedVersion?.number ?? 0) })}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">{t('services.publish.policy')}</legend>
                {OVERRIDE_FAMILIES.map((family) => (
                    <div key={family} className="flex flex-wrap items-center gap-4 text-sm">
                        <span className="min-w-56">{t(`services.publish.family.${family}`)}</span>
                        {OVERRIDE_LEVELS.map((level) => (
                            <span key={level} className="flex items-center gap-2">
                                <Checkbox
                                    id={`policy-${family}-${level}`}
                                    checked={policy[family]?.includes(level) ?? false}
                                    onCheckedChange={(on) => toggle(family, level, on === true)}
                                />
                                <Label htmlFor={`policy-${family}-${level}`}>
                                    {t(`services.publish.level.${level}`)}
                                </Label>
                            </span>
                        ))}
                    </div>
                ))}
            </fieldset>
            <div className="flex max-w-xs flex-col gap-2">
                <Label htmlFor="publish-from">{t('services.publish.effectiveFrom')}</Label>
                <EthiopianDatePicker
                    id="publish-from"
                    value={effectiveFrom}
                    onChange={setFrom}
                    min={today()}
                    language={language === 'en' ? 'en' : 'am'}
                    labels={dateLabels}
                />
            </div>
            <div>
                <Button type="button" onClick={() => void submit()} disabled={!workflowVersionId || publish.isPending}>
                    {t('services.publish.submit')}
                </Button>
            </div>
            <Conflicts conflicts={conflicts} />
        </section>
    );
}

const slaText = (t: (key: string, values?: Record<string, string>) => string, sla: unknown) => {
    const s = (sla ?? {}) as Sla;
    if (s.businessDays) return t('services.override.days', { n: String(s.businessDays) });
    if (s.businessHours) return t('services.override.hours', { n: String(s.businessHours) });
    return '—';
};

interface Editing {
    key: string;
    kind: 'sla' | 'help';
    title: string;
}

function OverrideEditor({ code }: { code: string }) {
    const { t, text } = useText();
    const notify = useNotify();
    const active = useAuthStore((s) => s.workspace?.activeUnit);
    const subtree = useSubtree(active?.id);
    const [unitId, setUnitId] = useState<string>();
    const shown = unitId ?? active?.id;
    const config = useServiceConfiguration(shown, code);
    const change = useChangeOverride(code);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [amount, setAmount] = useState('');
    const [per, setPer] = useState<'hours' | 'days'>('hours');
    // a help text in each of the installation's languages (the ones not shown are kept as they are)
    const languages = formLanguages(useAuthStore((s) => s.workspace?.settings['i18n.languages']));
    const [help, setHelp] = useState<Record<string, string>>({});
    const [reason, setReason] = useState('');
    const unitName = (id?: string) => {
        const u = subtree.data?.find((x) => x.id === id);
        return u ? text(u.name) : undefined;
    };
    const sourceName = (source: Source) =>
        source.level === 'default'
            ? t('services.override.source.default')
            : (unitName(source.unitId) ?? t(`services.override.source.${source.level}`));

    const failed = (error: unknown) =>
        notify.error(
            isApiError(error) && error.response?.status === 409
                ? t('services.override.changed')
                : getApiErrorMessage(error)
        );

    const open = (c: ServiceConfiguration, e: Editing) => {
        const current = c.values[e.key]?.value;
        if (e.kind === 'sla') {
            const s = (current ?? {}) as Sla;
            setPer(s.businessDays ? 'days' : 'hours');
            setAmount(String(s.businessDays ?? s.businessHours ?? ''));
        } else {
            setHelp({ ...((current ?? {}) as Record<string, string>) });
        }
        setReason(c.own?.reason ?? '');
        setEditing(e);
    };

    const save = async (c: ServiceConfiguration) => {
        if (!editing || !shown) return;
        const value =
            editing.kind === 'sla'
                ? per === 'days'
                    ? { businessDays: Number(amount) }
                    : { businessHours: Number(amount) }
                : Object.fromEntries(Object.entries(help).filter(([, v]) => v.trim() !== ''));
        // the values a newer version no longer takes are left out: they would refuse the whole override
        const kept = Object.fromEntries(
            Object.entries(c.own?.values ?? {}).filter(([key]) => !c.problems.some((p) => p.key === key))
        );
        try {
            await change.mutateAsync({
                unitId: shown,
                version: c.own?.version ?? 0,
                values: { ...kept, [editing.key]: value },
                reason
            });
            setEditing(null);
            notify.success(t('services.override.saved'));
        } catch (error) {
            failed(error);
        }
    };

    const reset = async (c: ServiceConfiguration) => {
        if (!c.own || !shown) return;
        const sure = await confirmAction({
            header: t('services.override.reset'),
            message: t('services.override.resetConfirm'),
            acceptLabel: t('services.override.reset'),
            rejectLabel: t('shell.settings.cancel')
        });
        if (!sure) return;
        try {
            await change.mutateAsync({ unitId: shown, version: c.own.version });
            notify.success(t('services.override.resetDone'));
        } catch (error) {
            failed(error);
        }
    };

    const c = config.data;
    const rows: (Editing & { value: string; source: Source | undefined; own: boolean })[] = c
        ? [
              ...c.states.map((s) => ({
                  key: `sla.${s.key}`,
                  kind: 'sla' as const,
                  title: t('services.override.sla', { state: s.label ? text(s.label) : s.key }),
                  value: slaText(t, c.values[`sla.${s.key}`]?.value),
                  source: c.values[`sla.${s.key}`]?.source,
                  own: c.own?.values[`sla.${s.key}`] !== undefined
              })),
              ...c.fields.map((f) => ({
                  key: `help.${f}`,
                  kind: 'help' as const,
                  title: t('services.override.help', { field: f }),
                  value: c.values[`help.${f}`] ? text(c.values[`help.${f}`]?.value as Text) : '—',
                  source: c.values[`help.${f}`]?.source,
                  own: c.own?.values[`help.${f}`] !== undefined
              }))
          ]
        : [];

    return (
        <section className="flex flex-col gap-4 rounded-md border p-4" data-section="override">
            <div>
                <h2 className="text-lg font-semibold">{t('services.override.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('services.override.intro')}</p>
            </div>
            <div className="flex max-w-md flex-col gap-2">
                <Label htmlFor="override-unit">{t('services.override.unit')}</Label>
                <Select value={shown} onValueChange={setUnitId}>
                    <SelectTrigger id="override-unit" className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {(subtree.data ?? []).map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                                {text(u.name)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {config.error ? (
                <p className="text-sm text-muted-foreground">
                    {isApiError(config.error) && config.error.response?.status === 409
                        ? t('services.override.notConfigured')
                        : getApiErrorMessage(config.error)}
                </p>
            ) : (
                c && (
                    <>
                        {!c.writable && (
                            <p className="text-sm text-muted-foreground">{t('services.override.readOnly')}</p>
                        )}
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('services.override.key')}</TableHead>
                                    <TableHead>{t('services.override.value')}</TableHead>
                                    <TableHead>{t('services.override.from')}</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((r) => (
                                    <TableRow key={r.key} data-config-key={r.key}>
                                        <TableCell>{r.title}</TableCell>
                                        <TableCell data-value>{r.value}</TableCell>
                                        <TableCell>
                                            {r.source && (
                                                <Badge
                                                    variant={r.own ? 'default' : 'outline'}
                                                    data-source={r.source.level}
                                                >
                                                    {sourceName(r.source)}
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {c.writable && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => open(c, r)}
                                                >
                                                    {t('shell.settings.change')}
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        {c.writable && c.own && (
                            <div>
                                <Button type="button" variant="ghost" onClick={() => void reset(c)}>
                                    {t('services.override.reset')}
                                </Button>
                            </div>
                        )}
                        <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
                            {editing && (
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>{editing.title}</DialogTitle>
                                        <DialogDescription>{unitName(shown)}</DialogDescription>
                                    </DialogHeader>
                                    {editing.kind === 'sla' ? (
                                        <div className="flex gap-2">
                                            <div className="flex flex-1 flex-col gap-2">
                                                <Label htmlFor="sla-amount">{t('services.override.amount')}</Label>
                                                <Input
                                                    id="sla-amount"
                                                    type="number"
                                                    min={1}
                                                    value={amount}
                                                    onChange={(e) => setAmount(e.target.value)}
                                                />
                                            </div>
                                            <div className="flex flex-1 flex-col gap-2">
                                                <Label htmlFor="sla-per">{t('services.override.per')}</Label>
                                                <Select
                                                    value={per}
                                                    onValueChange={(v) => setPer(v as 'hours' | 'days')}
                                                >
                                                    <SelectTrigger id="sla-per" className="w-full">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="hours">
                                                            {t('services.override.unitHours')}
                                                        </SelectItem>
                                                        <SelectItem value="days">
                                                            {t('services.override.unitDays')}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {languages.map((language) => (
                                                <div key={language} className="flex flex-col gap-1">
                                                    <Label htmlFor={`help-${language}`} lang={language}>
                                                        {(LANGUAGE_ENDONYMS as Record<string, string>)[language] ??
                                                            language}
                                                    </Label>
                                                    <Textarea
                                                        id={`help-${language}`}
                                                        lang={language}
                                                        value={help[language] ?? ''}
                                                        onChange={(e) =>
                                                            setHelp((h) => ({ ...h, [language]: e.target.value }))
                                                        }
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex flex-col gap-2">
                                        <Label htmlFor="override-reason">{t('services.override.reason')}</Label>
                                        <Input
                                            id="override-reason"
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                        />
                                    </div>
                                    <DialogFooter>
                                        <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                                            {t('shell.settings.cancel')}
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={() => void save(c)}
                                            disabled={
                                                change.isPending ||
                                                reason.trim().length < 3 ||
                                                (editing.kind === 'help' && (!help.am?.trim() || !help.en?.trim())) ||
                                                (editing.kind === 'sla' && !(Number(amount) >= 1))
                                            }
                                        >
                                            {t('services.override.save')}
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            )}
                        </Dialog>
                    </>
                )
            )}
        </section>
    );
}

export function ServiceDetail({ code }: { code: string }) {
    const { t, text } = useText();
    const services = useServices();
    const service = services.data?.find((s) => s.code === code);
    return (
        <div className="flex flex-col gap-6" data-screen="service" data-service-code={code}>
            <PageHeader title={service ? `${code} · ${text(service.name)}` : code} />
            <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">{t('services.service.versions')}</h2>
                <Versions code={code} />
            </section>
            <Publish code={code} />
            <OverrideEditor code={code} />
        </div>
    );
}
