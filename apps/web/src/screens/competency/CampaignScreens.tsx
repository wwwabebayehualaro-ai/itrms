'use client';

/**
 * Campaign counters (ADR-0054 §2, task 1.13i): a unit's campaigns (the plate exchange, the bolo season), and for each one every
 * office's count of today and so far against the target the unit above set, with the last 14 days. The unit that runs a campaign
 * sets the targets for the offices below it, never for its own, and closes it.
 */
import { useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    EmptyState,
    EthiopianDatePicker,
    Field,
    FieldLabel,
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
    ZodForm
} from '@itrms/ui';
import { CAMPAIGN_KINDS, MAX_CAMPAIGN_DAYS, MAX_CAMPAIGN_TARGET, spanDays } from '@itrms/competency/contracts';

import { getApiErrorMessage } from '@/lib/api/errors';
import {
    useCampaign,
    useCampaigns,
    useCloseCampaign,
    useCreateCampaign,
    useSetCampaignTarget,
    type Campaign,
    type CampaignOffice,
    type UnitRef
} from '@/lib/campaigns';
import { formatDay } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import { ErrorsOf, todayInAddis } from '@/screens/fees/form-bits';

/** The last days of an office as small bars, tallest the busiest day; plain boxes, no chart library. */
export function Series({ office, label }: { office: CampaignOffice; label: (day: string, count: number) => string }) {
    const peak = Math.max(1, ...office.series.map((d) => d.count));
    return (
        <div className="flex h-8 items-end gap-0.5" data-series>
            {office.series.map((d) => (
                <div
                    key={d.day}
                    className="bg-primary/70 w-1.5 rounded-sm"
                    style={{ height: `${Math.max(d.count === 0 ? 4 : 12, (d.count / peak) * 100)}%` }}
                    title={label(d.day, d.count)}
                    data-day={d.day}
                    data-count={d.count}
                />
            ))}
        </div>
    );
}

function pickerLabels(t: (key: string) => string) {
    return {
        placeholder: t('competency.campaign.picker.placeholder'),
        previousMonth: t('competency.campaign.picker.previousMonth'),
        nextMonth: t('competency.campaign.picker.nextMonth'),
        clear: t('competency.campaign.picker.clear'),
        month: t('competency.campaign.picker.month'),
        year: t('competency.campaign.picker.year')
    };
}

function CreateForm({ onDone }: { onDone: () => void }) {
    const { t, language } = useText();
    const notify = useNotify();
    const create = useCreateCampaign();
    const name = z
        .string()
        .trim()
        .min(2, t('competency.campaign.invalid.name'))
        .max(120, t('competency.campaign.invalid.name'));
    const schema = z
        .object({
            kind: z.enum(CAMPAIGN_KINDS),
            nameAm: name,
            nameEn: name,
            startsOn: z.string().min(1, t('competency.campaign.invalid.day')),
            endsOn: z.string().min(1, t('competency.campaign.invalid.day'))
        })
        .superRefine((v, ctx) => {
            if (v.startsOn && v.endsOn) {
                const span = spanDays(v.startsOn, v.endsOn);
                if (span < 1 || span > MAX_CAMPAIGN_DAYS)
                    ctx.addIssue({ code: 'custom', path: ['endsOn'], message: t('competency.campaign.invalid.span') });
            }
        });
    const form = useZodForm({
        schema,
        defaultValues: { kind: 'bolo_season', nameAm: '', nameEn: '', startsOn: todayInAddis(), endsOn: '' },
        onSubmit: async (v) => {
            await create.mutateAsync({
                kind: v.kind,
                name: { am: v.nameAm.trim(), en: v.nameEn.trim() },
                startsOn: v.startsOn,
                endsOn: v.endsOn
            });
            notify.success(t('competency.campaign.created'));
            onDone();
        }
    });
    const day = (field: 'startsOn' | 'endsOn', label: string) => (
        <form.AppField name={field}>
            {(f) => (
                <Field data-invalid={f.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel htmlFor={`campaign-${field}`}>{label}</FieldLabel>
                    <EthiopianDatePicker
                        id={`campaign-${field}`}
                        value={f.state.value || null}
                        onChange={(v) => f.handleChange(v ?? '')}
                        onOpenChange={(open) => !open && f.handleBlur()}
                        language={language === 'en' ? 'en' : 'am'}
                        labels={pickerLabels(t)}
                    />
                    <ErrorsOf errors={f.state.meta.errors} touched={f.state.meta.isTouched} />
                </Field>
            )}
        </form.AppField>
    );
    return (
        <ZodForm form={form}>
            <form.AppField name="kind">
                {(f) => (
                    <f.SelectField
                        label={t('competency.campaign.kind')}
                        options={CAMPAIGN_KINDS.map((k) => ({ value: k, label: t(`competency.campaign.kinds.${k}`) }))}
                    />
                )}
            </form.AppField>
            <form.AppField name="nameAm">
                {(f) => (
                    <f.TextField
                        label={t('competency.campaign.nameAm')}
                        maxLength={120}
                        autoComplete="off"
                        data-field="name-am"
                    />
                )}
            </form.AppField>
            <form.AppField name="nameEn">
                {(f) => (
                    <f.TextField
                        label={t('competency.campaign.nameEn')}
                        maxLength={120}
                        autoComplete="off"
                        data-field="name-en"
                    />
                )}
            </form.AppField>
            {day('startsOn', t('competency.campaign.startsOn'))}
            {day('endsOn', t('competency.campaign.endsOn'))}
            <div className="flex justify-end">
                <form.AppForm>
                    <form.SubmitButton data-action="create-campaign">
                        {t('competency.campaign.create')}
                    </form.SubmitButton>
                </form.AppForm>
            </div>
        </ZodForm>
    );
}

export function Campaigns() {
    const { t, text, language } = useText();
    const { calendar } = usePreferences();
    const list = useCampaigns();
    const [creating, setCreating] = useState(false);
    if (list.isPending) return <Skeleton className="h-40 w-full" />;
    if (list.error)
        return (
            <EmptyState
                variant="error"
                title={t('competency.campaign.error')}
                description={getApiErrorMessage(list.error)}
            />
        );
    const { items, mayManage } = list.data;
    return (
        <div className="flex flex-col gap-6" data-screen="campaigns">
            <PageHeader
                title={t('competency.campaign.title')}
                description={t('competency.campaign.intro')}
                actions={
                    mayManage ? (
                        <Button data-action="new-campaign" onClick={() => setCreating(true)}>
                            {t('competency.campaign.new')}
                        </Button>
                    ) : undefined
                }
            />
            {items.length === 0 ? (
                <EmptyState title={t('competency.campaign.empty')} />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('competency.campaign.title')}</TableHead>
                            <TableHead>{t('competency.campaign.kind')}</TableHead>
                            <TableHead />
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((c: Campaign) => (
                            <TableRow key={c.id} data-campaign={c.id} data-kind={c.kind}>
                                <TableCell className="font-medium">
                                    <Link href={`/competency/campaigns/${c.id}`}>
                                        {text({ am: '', en: '', ...c.name })}
                                    </Link>
                                    <div className="text-muted-foreground text-xs">
                                        {t('competency.campaign.runBy', {
                                            unit: text({ am: '', en: '', ...c.unit.name })
                                        })}
                                    </div>
                                </TableCell>
                                <TableCell>{t(`competency.campaign.kinds.${c.kind}`)}</TableCell>
                                <TableCell>
                                    {t('competency.campaign.period', {
                                        from: formatDay(c.startsOn, { language, calendar }),
                                        to: formatDay(c.endsOn, { language, calendar })
                                    })}
                                </TableCell>
                                <TableCell>
                                    <StatusBadge
                                        value={c.closedAt ? 'closed' : 'open'}
                                        tone={c.closedAt ? 'muted' : 'success'}
                                        label={t(
                                            c.closedAt ? 'competency.campaign.closed' : 'competency.campaign.open'
                                        )}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            <Dialog open={creating} onOpenChange={setCreating}>
                <DialogContent data-campaign-dialog>
                    <DialogHeader>
                        <DialogTitle>{t('competency.campaign.new')}</DialogTitle>
                        <DialogDescription>{t('competency.campaign.intro')}</DialogDescription>
                    </DialogHeader>
                    {creating && <CreateForm onDone={() => setCreating(false)} />}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function TargetForm({
    campaignId,
    office,
    onDone
}: {
    campaignId: string;
    office: CampaignOffice;
    onDone: () => void;
}) {
    const { t } = useText();
    const notify = useNotify();
    const set = useSetCampaignTarget(campaignId);
    const invalid = t('competency.campaign.invalid.target');
    const schema = z.object({
        target: z
            .string()
            .regex(/^\d{1,8}$/, invalid)
            .refine((v) => Number(v) >= 1 && Number(v) <= MAX_CAMPAIGN_TARGET, invalid)
    });
    const form = useZodForm({
        schema,
        defaultValues: { target: office.target ? String(office.target.count) : '' },
        onSubmit: async (v) => {
            await set.mutateAsync({
                target: { unitId: office.unit.id, target: Number(v.target) },
                version: office.target?.version ?? null
            });
            notify.success(t('competency.campaign.saved'));
            onDone();
        }
    });
    return (
        <ZodForm form={form}>
            <form.AppField name="target">
                {(f) => (
                    <f.TextField
                        label={t('competency.campaign.targetLabel')}
                        inputMode="numeric"
                        maxLength={8}
                        autoComplete="off"
                        data-field="target"
                    />
                )}
            </form.AppField>
            <div className="flex justify-end">
                <form.AppForm>
                    <form.SubmitButton data-action="save-target">
                        {t('competency.campaign.saveTarget')}
                    </form.SubmitButton>
                </form.AppForm>
            </div>
        </ZodForm>
    );
}

/** A first target for an office below the caller that offers the service the campaign counts: the office is picked from the candidates. */
function AddTargetForm({
    campaignId,
    candidates,
    onDone
}: {
    campaignId: string;
    candidates: readonly UnitRef[];
    onDone: () => void;
}) {
    const { t, text } = useText();
    const notify = useNotify();
    const set = useSetCampaignTarget(campaignId);
    const invalid = t('competency.campaign.invalid.target');
    const schema = z.object({
        unitId: z.string().min(1, t('competency.campaign.invalid.office')),
        target: z
            .string()
            .regex(/^\d{1,8}$/, invalid)
            .refine((v) => Number(v) >= 1 && Number(v) <= MAX_CAMPAIGN_TARGET, invalid)
    });
    const form = useZodForm({
        schema,
        defaultValues: { unitId: '', target: '' },
        onSubmit: async (v) => {
            await set.mutateAsync({ target: { unitId: v.unitId, target: Number(v.target) }, version: null });
            notify.success(t('competency.campaign.saved'));
            onDone();
        }
    });
    return (
        <ZodForm form={form}>
            <form.AppField name="unitId">
                {(f) => (
                    <f.SelectField
                        label={t('competency.campaign.office')}
                        placeholder={t('competency.campaign.pickOffice')}
                        options={candidates.map((u) => ({ value: u.id, label: text({ am: '', en: '', ...u.name }) }))}
                    />
                )}
            </form.AppField>
            <form.AppField name="target">
                {(f) => (
                    <f.TextField
                        label={t('competency.campaign.targetLabel')}
                        inputMode="numeric"
                        maxLength={8}
                        autoComplete="off"
                        data-field="target"
                    />
                )}
            </form.AppField>
            <div className="flex justify-end">
                <form.AppForm>
                    <form.SubmitButton data-action="save-target">
                        {t('competency.campaign.saveTarget')}
                    </form.SubmitButton>
                </form.AppForm>
            </div>
        </ZodForm>
    );
}

export function CampaignDetail({ id }: { id: string }) {
    const { t, text, language } = useText();
    const { calendar } = usePreferences();
    const notify = useNotify();
    const progress = useCampaign(id);
    const close = useCloseCampaign(id);
    const [target, setTarget] = useState<CampaignOffice | null>(null);
    const [adding, setAdding] = useState(false);
    if (progress.isPending) return <Skeleton className="h-40 w-full" />;
    if (progress.error)
        return (
            <EmptyState
                variant="error"
                title={t('competency.campaign.error')}
                description={getApiErrorMessage(progress.error)}
            />
        );
    const { campaign, offices, total, mayManage, mayClose, candidates, ownUnitId } = progress.data;
    const name = text({ am: '', en: '', ...campaign.name });
    const open = campaign.closedAt === null;
    return (
        <div
            className="flex flex-col gap-6"
            data-screen="campaign"
            data-campaign={campaign.id}
            data-kind={campaign.kind}
        >
            <PageHeader
                title={name}
                description={`${t(`competency.campaign.kinds.${campaign.kind}`)} · ${t('competency.campaign.period', {
                    from: formatDay(campaign.startsOn, { language, calendar }),
                    to: formatDay(campaign.endsOn, { language, calendar })
                })} · ${t('competency.campaign.runBy', { unit: text({ am: '', en: '', ...campaign.unit.name }) })}`}
                actions={
                    <div className="flex items-center gap-2">
                        <StatusBadge
                            value={open ? 'open' : 'closed'}
                            tone={open ? 'success' : 'muted'}
                            label={t(open ? 'competency.campaign.open' : 'competency.campaign.closed')}
                        />
                        {mayManage && open && candidates.length > 0 && (
                            <Button variant="outline" data-action="add-target" onClick={() => setAdding(true)}>
                                {t('competency.campaign.addTarget')}
                            </Button>
                        )}
                        {mayClose && open && (
                            <Button
                                variant="outline"
                                data-action="close-campaign"
                                disabled={close.isPending}
                                onClick={() =>
                                    void close
                                        .mutateAsync(campaign.version)
                                        .then(() => notify.success(t('competency.campaign.closedDone')))
                                }
                            >
                                {t('competency.campaign.close')}
                            </Button>
                        )}
                    </div>
                }
            />
            <Button asChild variant="ghost" size="sm" className="self-start">
                <Link href="/competency/campaigns">{t('competency.campaign.back')}</Link>
            </Button>
            {offices.length === 0 ? (
                <EmptyState title={t('competency.campaign.noOffices')} />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('competency.campaign.office')}</TableHead>
                            <TableHead>{t('competency.campaign.today')}</TableHead>
                            <TableHead>{t('competency.campaign.total')}</TableHead>
                            <TableHead>{t('competency.campaign.target')}</TableHead>
                            <TableHead>{t('competency.campaign.expected')}</TableHead>
                            <TableHead>{t('competency.campaign.status')}</TableHead>
                            <TableHead>{t('competency.campaign.series')}</TableHead>
                            {mayManage && open && <TableHead />}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {offices.map((o) => (
                            <TableRow
                                key={o.unit.id}
                                data-office={o.unit.code}
                                data-on-track={o.onTrack === null ? 'none' : String(o.onTrack)}
                            >
                                <TableCell className="font-medium">
                                    {text({ am: '', en: '', ...o.unit.name })}
                                </TableCell>
                                <TableCell data-cell="today">{o.today}</TableCell>
                                <TableCell data-cell="total">{o.total}</TableCell>
                                <TableCell data-cell="target">{o.target?.count ?? '—'}</TableCell>
                                <TableCell data-cell="expected">{o.expected ?? '—'}</TableCell>
                                <TableCell>
                                    {o.onTrack === null ? (
                                        <span className="text-muted-foreground text-sm">
                                            {t('competency.campaign.noTarget')}
                                        </span>
                                    ) : (
                                        <StatusBadge
                                            value={o.onTrack ? 'on-track' : 'behind'}
                                            tone={o.onTrack ? 'success' : 'warning'}
                                            label={t(
                                                o.onTrack ? 'competency.campaign.onTrack' : 'competency.campaign.behind'
                                            )}
                                        />
                                    )}
                                </TableCell>
                                <TableCell>
                                    <Series
                                        office={o}
                                        label={(day, count) =>
                                            t('competency.campaign.seriesDay', {
                                                day: formatDay(day, { language, calendar }),
                                                count: String(count)
                                            })
                                        }
                                    />
                                </TableCell>
                                {mayManage && open && (
                                    <TableCell>
                                        {o.unit.id !== ownUnitId && o.unit.id !== campaign.unit.id && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                data-action="set-target"
                                                onClick={() => setTarget(o)}
                                            >
                                                {t('competency.campaign.setTarget')}
                                            </Button>
                                        )}
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                        <TableRow data-office="total">
                            <TableCell className="font-medium">{t('competency.campaign.grandTotal')}</TableCell>
                            <TableCell data-cell="today">{total.today}</TableCell>
                            <TableCell data-cell="total">{total.total}</TableCell>
                            <TableCell data-cell="target">{total.target ?? '—'}</TableCell>
                            <TableCell data-cell="expected">{total.expected ?? '—'}</TableCell>
                            <TableCell />
                            <TableCell />
                            {mayManage && open && <TableCell />}
                        </TableRow>
                    </TableBody>
                </Table>
            )}
            <Dialog open={adding} onOpenChange={setAdding}>
                <DialogContent data-add-target-dialog>
                    <DialogHeader>
                        <DialogTitle>{t('competency.campaign.addTargetTitle')}</DialogTitle>
                        <DialogDescription>{t('competency.campaign.addTargetIntro')}</DialogDescription>
                    </DialogHeader>
                    {adding && (
                        <AddTargetForm
                            campaignId={campaign.id}
                            candidates={candidates}
                            onDone={() => setAdding(false)}
                        />
                    )}
                </DialogContent>
            </Dialog>
            <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
                <DialogContent data-target-dialog>
                    <DialogHeader>
                        <DialogTitle>{t('competency.campaign.dialogTitle')}</DialogTitle>
                        <DialogDescription>
                            {target
                                ? t('competency.campaign.dialogFor', {
                                      office: text({ am: '', en: '', ...target.unit.name }),
                                      campaign: name
                                  })
                                : ''}
                        </DialogDescription>
                    </DialogHeader>
                    {target && (
                        <TargetForm
                            key={target.unit.id}
                            campaignId={campaign.id}
                            office={target}
                            onDone={() => setTarget(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
