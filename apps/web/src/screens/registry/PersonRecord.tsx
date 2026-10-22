'use client';

/**
 * A person of the register (task 0.14): what every office may see, and whether each sensitive field is on record. Those
 * fields are shown only after a reveal: `pii:reveal`, a reason (kept in the audit log) and a second factor in the last five
 * minutes (the BFF asks for it when it is older). What is revealed stays on this screen and is never cached.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SENSITIVE_FIELDS } from '@itrms/parties/contracts';
import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    Checkbox,
    DescriptionList,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    PageHeader,
    PersonName,
    RadioGroup,
    RadioGroupItem,
    Skeleton,
    Textarea
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { formatDay } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';
import {
    usePerson,
    usePersonSearch,
    useRequestMerge,
    useReveal,
    type Person,
    type SensitiveField
} from '@/lib/registry';

export function PersonRecord({ id }: { id: string }) {
    const { t, text } = useText();
    const person = usePerson(id);
    const permissions = useAuthStore((s) => s.workspace?.permissions ?? []);

    if (person.isPending) return <Skeleton className="h-48 w-full" />;
    if (person.error || !person.data)
        return (
            <Alert variant="destructive">
                <AlertDescription>{getApiErrorMessage(person.error, t('parties.record.notFound'))}</AlertDescription>
            </Alert>
        );
    const p = person.data;
    const unit = (name: Record<string, string>) => text({ am: '', en: '', ...name });

    return (
        <div className="flex max-w-4xl flex-col gap-6" data-screen="person-record">
            <PageHeader
                title={<PersonName ethiopic={p.nameAm} latin={p.nameEn ?? undefined} both />}
                status={
                    p.status === 'merged' ? <Badge variant="secondary">{t('parties.persons.merged')}</Badge> : undefined
                }
                meta={t('parties.record.handledBy', { unit: unit(p.handlingUnit.name) })}
                actions={
                    p.status === 'active' && (
                        <>
                            {permissions.includes('person:merge') && <MergeRequest person={p} />}
                            {permissions.includes('person:update') && (
                                <Button asChild variant="outline">
                                    <Link href={`/registry/persons/${p.id}/edit`}>{t('parties.record.edit')}</Link>
                                </Button>
                            )}
                        </>
                    )
                }
            />
            {p.mergedIntoId && (
                <Alert>
                    <AlertDescription>
                        {t('parties.record.mergedInto')}{' '}
                        <Link href={`/registry/persons/${p.mergedIntoId}`} className="underline">
                            {t('parties.record.openKept')}
                        </Link>
                    </AlertDescription>
                </Alert>
            )}
            <DescriptionList
                items={[
                    { term: t('parties.field.sex'), value: t(`parties.sex.${p.sex}`) },
                    { term: t('parties.field.birthYear'), value: p.birthYear },
                    {
                        term: t('parties.field.address'),
                        value: p.address
                            ? [
                                  unit(p.address.unit.name),
                                  p.address.kebele && `${t('parties.field.kebele')} ${p.address.kebele}`,
                                  p.address.houseNumber
                              ]
                                  .filter(Boolean)
                                  .join(', ')
                            : null
                    },
                    { term: t('parties.field.handlingUnit'), value: unit(p.handlingUnit.name) }
                ]}
            />
            <Sensitive person={p} canReveal={permissions.includes('pii:reveal')} />
        </div>
    );
}

function Sensitive({ person, canReveal }: { person: Person; canReveal: boolean }) {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const reveal = useReveal(person.id);
    const [open, setOpen] = useState(false);
    const onRecord = SENSITIVE_FIELDS.filter((f) => person.sensitive[f]);
    const [fields, setFields] = useState<SensitiveField[]>(onRecord);
    const [reason, setReason] = useState('');
    const shown = reveal.data;
    const { reset } = reveal;
    // what was revealed is dropped when the person leaves the record
    useEffect(() => reset, [reset]);

    const show = (field: SensitiveField) => {
        if (!person.sensitive[field]) return t('parties.record.notRecorded');
        const value = shown?.[field];
        if (value === undefined) return <span aria-label={t('parties.record.hidden')}>••••••</span>;
        if (value === null) return t('parties.record.notRecorded');
        return field === 'birthDate' ? (
            formatDay(value, { language, calendar })
        ) : (
            <span className="font-mono">{value}</span>
        );
    };

    return (
        <section className="flex flex-col gap-3 rounded-md border p-4" data-sensitive>
            <div className="flex items-center justify-between gap-2">
                <h2 className="font-medium">{t('parties.form.sensitive')}</h2>
                {canReveal && onRecord.length > 0 && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            reveal.reset();
                            setOpen(true);
                        }}
                    >
                        {t('parties.reveal.button')}
                    </Button>
                )}
            </div>
            <DescriptionList items={SENSITIVE_FIELDS.map((f) => ({ term: t(`parties.field.${f}`), value: show(f) }))} />
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('parties.reveal.title')}</DialogTitle>
                        <DialogDescription>{t('parties.reveal.intro')}</DialogDescription>
                    </DialogHeader>
                    <form
                        className="flex flex-col gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            reveal.mutate({ fields, reason }, { onSuccess: () => setOpen(false) });
                        }}
                    >
                        <fieldset className="flex flex-col gap-2">
                            {onRecord.map((f) => (
                                <div key={f} className="flex items-center gap-2">
                                    <Checkbox
                                        id={`reveal-${f}`}
                                        checked={fields.includes(f)}
                                        onCheckedChange={(on) =>
                                            setFields((now) => (on === true ? [...now, f] : now.filter((x) => x !== f)))
                                        }
                                    />
                                    <Label htmlFor={`reveal-${f}`}>{t(`parties.field.${f}`)}</Label>
                                </div>
                            ))}
                        </fieldset>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="reveal-reason">{t('parties.reveal.reason')}</Label>
                            <Textarea
                                id="reveal-reason"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                minLength={10}
                                maxLength={500}
                                required
                            />
                        </div>
                        {reveal.error && (
                            <Alert variant="destructive">
                                <AlertDescription>{getApiErrorMessage(reveal.error)}</AlertDescription>
                            </Alert>
                        )}
                        <DialogFooter>
                            <Button
                                type="submit"
                                disabled={fields.length === 0 || reason.trim().length < 10 || reveal.isPending}
                            >
                                {t('parties.reveal.confirm')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </section>
    );
}

/** Asks for this record to be merged into another: a second person approves (the merges screen). */
function MergeRequest({ person }: { person: Person }) {
    const { t } = useText();
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [survivor, setSurvivor] = useState<string>();
    const [reason, setReason] = useState('');
    const found = usePersonSearch(open ? q : '');
    const request = useRequestMerge();

    return (
        <>
            <Button type="button" variant="outline" onClick={() => setOpen(true)}>
                {t('parties.merge.request')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('parties.merge.title')}</DialogTitle>
                        <DialogDescription>{t('parties.merge.intro')}</DialogDescription>
                    </DialogHeader>
                    {request.isSuccess ? (
                        <Alert>
                            <AlertDescription>{t('parties.merge.sent')}</AlertDescription>
                        </Alert>
                    ) : (
                        <form
                            className="flex flex-col gap-4"
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (survivor) request.mutate({ survivorId: survivor, duplicateId: person.id, reason });
                            }}
                        >
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="merge-search">{t('parties.merge.keep')}</Label>
                                <Input id="merge-search" value={q} onChange={(e) => setQ(e.target.value)} />
                                <RadioGroup
                                    value={survivor ?? ''}
                                    onValueChange={setSurvivor}
                                    className="max-h-48 overflow-auto"
                                    aria-label={t('parties.merge.keep')}
                                >
                                    {(found.data ?? [])
                                        .filter((p) => p.id !== person.id && p.status === 'active')
                                        .map((p) => (
                                            <div key={p.id} className="flex items-center gap-2">
                                                <RadioGroupItem id={`survivor-${p.id}`} value={p.id} />
                                                <Label htmlFor={`survivor-${p.id}`} className="font-normal">
                                                    <PersonName
                                                        ethiopic={p.nameAm}
                                                        latin={p.nameEn ?? undefined}
                                                        both
                                                    />
                                                    <span className="text-muted-foreground text-xs">{p.birthYear}</span>
                                                </Label>
                                            </div>
                                        ))}
                                </RadioGroup>
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="merge-reason">{t('parties.merge.reason')}</Label>
                                <Textarea
                                    id="merge-reason"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    maxLength={500}
                                />
                            </div>
                            {request.error && (
                                <Alert variant="destructive">
                                    <AlertDescription>{getApiErrorMessage(request.error)}</AlertDescription>
                                </Alert>
                            )}
                            <DialogFooter>
                                <Button
                                    type="submit"
                                    disabled={!survivor || reason.trim().length < 10 || request.isPending}
                                >
                                    {t('parties.merge.send')}
                                </Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
