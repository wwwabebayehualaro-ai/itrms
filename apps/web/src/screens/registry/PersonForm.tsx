'use client';

/**
 * Registering or correcting a person (task 0.14). Names in Ethiopic (F9 types Fidel from Latin letters) and, optionally,
 * Latin script; the birth date is picked on the Ethiopian calendar and stored Gregorian. Before a new record is saved,
 * the register is asked who it may already be (same FIN, or same name with the same birth date or phone): the clerk sees
 * them and decides. On a correction the sensitive fields are never shown: one typed replaces what is on record, one left
 * empty stays as it is.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ethiopicNameSchema, finSchema, isoDateSchema, latinNameSchema, phoneSchema } from '@itrms/parties/contracts';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    EthiopianDatePicker,
    Label,
    PageHeader,
    PersonName,
    useNotify,
    useZodForm,
    ZodForm
} from '@itrms/ui';
import { z } from 'zod';

import { isApiError } from '@/lib/api/client';
import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { usePreferences, useText } from '@/lib/preferences';
import {
    useAddressUnits,
    useCreatePerson,
    useDuplicateCheck,
    useUpdatePerson,
    type DuplicateList,
    type Person
} from '@/lib/registry';

const blank = (v: string) => v.trim() === '';
const valid = (schema: z.ZodType, v: string) => blank(v) || schema.safeParse(v).success;

function formSchema(t: (key: string) => string) {
    const ethiopic = ethiopicNameSchema.shape.given;
    const latin = latinNameSchema.shape.given;
    const required = (schema: z.ZodType) =>
        z
            .string()
            .refine((v) => !blank(v), t('parties.form.required'))
            .refine((v) => valid(schema, v), t('parties.form.ethiopicOnly'));
    const optional = (schema: z.ZodType, message: string) => z.string().refine((v) => valid(schema, v), message);
    return z
        .object({
            givenAm: required(ethiopic),
            fatherAm: required(ethiopic),
            grandfatherAm: optional(ethiopic, t('parties.form.ethiopicOnly')),
            givenEn: optional(latin, t('parties.form.latinOnly')),
            fatherEn: optional(latin, t('parties.form.latinOnly')),
            grandfatherEn: optional(latin, t('parties.form.latinOnly')),
            sex: z.string().refine((v) => ['female', 'male'].includes(v), t('parties.form.required')),
            birthYear: z.string().refine((v) => blank(v) || /^(19|20)\d\d$/.test(v.trim()), t('parties.form.year')),
            birthDate: optional(isoDateSchema, t('parties.form.date')),
            phone: optional(phoneSchema, t('parties.field.phoneHint')),
            fin: optional(finSchema, t('parties.field.finHint')),
            addressUnitId: z.string(),
            kebele: z.string().max(60),
            houseNumber: z.string().max(30)
        })
        .refine((v) => blank(v.givenEn) === blank(v.fatherEn), {
            path: ['fatherEn'],
            message: t('parties.form.latinBoth')
        });
}
type FormValues = z.infer<ReturnType<typeof formSchema>>;

const orNone = (v: string) => (blank(v) ? undefined : v.trim());

/** The form's values as the API takes them. */
function toInput(v: FormValues) {
    const latin =
        orNone(v.givenEn) && orNone(v.fatherEn)
            ? { given: v.givenEn.trim(), father: v.fatherEn.trim(), grandfather: orNone(v.grandfatherEn) }
            : undefined;
    const sensitive = Object.fromEntries(
        (['birthDate', 'phone', 'fin'] as const).flatMap((k) => (orNone(v[k]) ? [[k, v[k].trim()]] : []))
    );
    return {
        nameAm: { given: v.givenAm.trim(), father: v.fatherAm.trim(), grandfather: orNone(v.grandfatherAm) },
        nameEn: latin,
        sex: v.sex as 'female' | 'male',
        birthYear: orNone(v.birthYear) ? Number(v.birthYear) : undefined,
        address: orNone(v.addressUnitId)
            ? { unitId: v.addressUnitId, kebele: orNone(v.kebele), houseNumber: orNone(v.houseNumber) }
            : undefined,
        sensitive: Object.keys(sensitive).length ? sensitive : undefined
    };
}

const fromPerson = (p?: Person): FormValues => ({
    givenAm: p?.nameAm.given ?? '',
    fatherAm: p?.nameAm.father ?? '',
    grandfatherAm: p?.nameAm.grandfather ?? '',
    givenEn: p?.nameEn?.given ?? '',
    fatherEn: p?.nameEn?.father ?? '',
    grandfatherEn: p?.nameEn?.grandfather ?? '',
    sex: p?.sex ?? '',
    birthYear: p?.birthYear ? String(p.birthYear) : '',
    birthDate: '',
    phone: '',
    fin: '',
    addressUnitId: p?.address?.unit.id ?? '',
    kebele: p?.address?.kebele ?? '',
    houseNumber: p?.address?.houseNumber ?? ''
});

export function PersonForm({ person }: { person?: Person }) {
    const { t, text, language } = useText();
    const router = useRouter();
    const notify = useNotify();
    const calendar = usePreferences((s) => s.calendar);
    const unitId = useAuthStore((s) => s.workspace?.activeUnit.id);
    const units = useAddressUnits(unitId);
    const check = useDuplicateCheck();
    const create = useCreatePerson();
    const update = useUpdatePerson(person?.id ?? '');
    const [duplicates, setDuplicates] = useState<DuplicateList['items']>();
    const [problem, setProblem] = useState<string>();
    const schema = useMemo(() => formSchema(t), [t]);

    const save = async (values: FormValues, acknowledged: string[] = []) => {
        setProblem(undefined);
        const input = toInput(values);
        try {
            if (person) {
                const saved = await update.mutateAsync({
                    version: person.version,
                    changes: {
                        ...input,
                        nameEn: input.nameEn ?? null,
                        address: input.address ?? null,
                        // with a birth date on record the year follows it: sent only with a new date
                        birthYear:
                            person.sensitive.birthDate && !input.sensitive?.birthDate
                                ? undefined
                                : (input.birthYear ?? null)
                    }
                });
                notify.success(t('parties.form.saved'));
                router.push(`/registry/persons/${saved.id}`);
                return;
            }
            if (acknowledged.length === 0) {
                const found = await check.mutateAsync({
                    nameAm: input.nameAm,
                    nameEn: input.nameEn,
                    sensitive: input.sensitive
                });
                if (found.items.length) {
                    setDuplicates(found.items);
                    return;
                }
            }
            const saved = await create.mutateAsync({ ...input, acknowledgedDuplicates: acknowledged });
            notify.success(t('parties.form.registered'));
            router.push(`/registry/persons/${saved.id}`);
        } catch (error) {
            setProblem(
                isApiError(error) && error.response?.status === 409
                    ? t('parties.form.finTaken')
                    : getApiErrorMessage(error, t('parties.form.failed'))
            );
        }
    };

    const form = useZodForm({ schema, defaultValues: fromPerson(person), onSubmit: (v) => save(v) });
    const unitOptions = (units.data ?? []).map((u) => ({ value: u.id, label: text({ am: '', en: '', ...u.name }) }));
    const sameFin = duplicates?.some((d) => d.reasons.includes('fin'));

    return (
        <div className="flex max-w-3xl flex-col gap-6" data-screen={person ? 'person-edit' : 'person-new'}>
            <PageHeader
                title={t(person ? 'parties.form.editTitle' : 'parties.form.newTitle')}
                description={t('parties.form.intro')}
            />
            <ZodForm form={form} className="flex flex-col gap-6">
                <fieldset className="grid gap-4 sm:grid-cols-3">
                    <legend className="mb-2 font-medium">{t('parties.form.nameAm')}</legend>
                    <form.AppField name="givenAm">
                        {(f) => <f.TextField label={t('parties.field.given')} ethiopic lang="am" />}
                    </form.AppField>
                    <form.AppField name="fatherAm">
                        {(f) => <f.TextField label={t('parties.field.father')} ethiopic lang="am" />}
                    </form.AppField>
                    <form.AppField name="grandfatherAm">
                        {(f) => <f.TextField label={t('parties.field.grandfather')} ethiopic lang="am" />}
                    </form.AppField>
                    <p className="text-muted-foreground text-xs sm:col-span-3">{t('parties.form.ethiopicHint')}</p>
                </fieldset>
                <fieldset className="grid gap-4 sm:grid-cols-3">
                    <legend className="mb-2 font-medium">{t('parties.form.nameEn')}</legend>
                    <form.AppField name="givenEn">
                        {(f) => <f.TextField label={t('parties.field.given')} lang="en" />}
                    </form.AppField>
                    <form.AppField name="fatherEn">
                        {(f) => <f.TextField label={t('parties.field.father')} lang="en" />}
                    </form.AppField>
                    <form.AppField name="grandfatherEn">
                        {(f) => <f.TextField label={t('parties.field.grandfather')} lang="en" />}
                    </form.AppField>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-3">
                    <form.AppField name="sex">
                        {(f) => (
                            <f.SelectField
                                label={t('parties.field.sex')}
                                placeholder={t('parties.form.choose')}
                                options={[
                                    { value: 'female', label: t('parties.sex.female') },
                                    { value: 'male', label: t('parties.sex.male') }
                                ]}
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="birthYear">
                        {(f) => (
                            <f.TextField
                                label={t('parties.field.birthYear')}
                                description={t('parties.form.birthYearHint')}
                                inputMode="numeric"
                                disabled={person?.sensitive.birthDate}
                            />
                        )}
                    </form.AppField>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                    <form.AppField name="addressUnitId">
                        {(f) => (
                            <f.SelectField
                                label={t('parties.field.address')}
                                placeholder={t('parties.form.choose')}
                                options={unitOptions}
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="kebele">
                        {(f) => <f.TextField label={t('parties.field.kebele')} />}
                    </form.AppField>
                    <form.AppField name="houseNumber">
                        {(f) => <f.TextField label={t('parties.field.houseNumber')} />}
                    </form.AppField>
                </div>
                <fieldset className="grid gap-4 rounded-md border p-4 sm:grid-cols-3">
                    <legend className="px-1 font-medium">{t('parties.form.sensitive')}</legend>
                    <p className="text-muted-foreground text-xs sm:col-span-3">
                        {t(person ? 'parties.form.sensitiveEdit' : 'parties.form.sensitiveNew')}
                    </p>
                    <form.Field name="birthDate">
                        {(field) => (
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="birthDate">{t('parties.field.birthDate')}</Label>
                                <EthiopianDatePicker
                                    id="birthDate"
                                    value={field.state.value || null}
                                    onChange={(v) => field.handleChange(v ?? '')}
                                    language={language === 'en' ? 'en' : 'am'}
                                    max={new Date().toISOString().slice(0, 10)}
                                    labels={{
                                        placeholder: t('parties.form.pickDate'),
                                        previousMonth: t('parties.form.previousMonth'),
                                        nextMonth: t('parties.form.nextMonth'),
                                        clear: t('parties.form.clear'),
                                        month: t('parties.form.month'),
                                        year: t('parties.form.year')
                                    }}
                                />
                                {calendar === 'gregorian' && field.state.value && (
                                    <span className="text-muted-foreground text-xs">{field.state.value}</span>
                                )}
                            </div>
                        )}
                    </form.Field>
                    <form.AppField name="phone">
                        {(f) => (
                            <f.TextField
                                label={t('parties.field.phone')}
                                description={t('parties.field.phoneHint')}
                                inputMode="tel"
                                autoComplete="off"
                            />
                        )}
                    </form.AppField>
                    <form.AppField name="fin">
                        {(f) => (
                            <f.TextField
                                label={t('parties.field.fin')}
                                description={t('parties.field.finHint')}
                                inputMode="numeric"
                                autoComplete="off"
                            />
                        )}
                    </form.AppField>
                </fieldset>

                {problem && (
                    <Alert variant="destructive">
                        <AlertDescription>{problem}</AlertDescription>
                    </Alert>
                )}
                {duplicates && duplicates.length > 0 && (
                    <Alert data-duplicates>
                        <AlertTitle>{t('parties.duplicates.title')}</AlertTitle>
                        <AlertDescription className="flex flex-col gap-3">
                            <p>{t(sameFin ? 'parties.duplicates.sameFin' : 'parties.duplicates.intro')}</p>
                            <ul className="flex flex-col gap-1">
                                {duplicates.map((d) => (
                                    <li key={d.person.id}>
                                        <Link
                                            href={`/registry/persons/${d.person.id}`}
                                            target="_blank"
                                            className="font-medium hover:underline"
                                        >
                                            <PersonName
                                                ethiopic={d.person.nameAm}
                                                latin={d.person.nameEn ?? undefined}
                                                both
                                            />
                                        </Link>{' '}
                                        <span className="text-muted-foreground text-xs">
                                            {d.reasons.map((r) => t(`parties.duplicates.${r}`)).join(' · ')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            {!sameFin && (
                                <div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() =>
                                            void save(
                                                form.state.values,
                                                duplicates.map((d) => d.person.id)
                                            )
                                        }
                                    >
                                        {t('parties.duplicates.different')}
                                    </Button>
                                </div>
                            )}
                        </AlertDescription>
                    </Alert>
                )}
                <div className="flex gap-2">
                    <form.AppForm>
                        <form.SubmitButton>
                            {t(person ? 'parties.form.save' : 'parties.form.register')}
                        </form.SubmitButton>
                    </form.AppForm>
                    <Button type="button" variant="ghost" onClick={() => router.back()}>
                        {t('parties.form.cancel')}
                    </Button>
                </div>
            </ZodForm>
        </div>
    );
}
