'use client';

/**
 * A request at the counter (task 0.21c): the services the office offers and that are configured; the chosen service's
 * request form (the version its configuration names, with the help texts set for this office), filled and filed with
 * the new case in one transaction (`POST /api/v1/service-requests`, validated on the server); then the case page. A form
 * with a Fee field shows the server's preview of the fee, and the filing sends the figure shown (task 0.22a).
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FeeSourceProvider, FormRenderer, useLatestFee, type FormField } from '@itrms/form-engine/renderer';
import { useQueryClient } from '@tanstack/react-query';
import {
    Button,
    EmptyState,
    InlineStatus,
    Label,
    PageHeader,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    useNotify
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useText } from '@/lib/preferences';
import { fileRequest, useFormVersion, useRequestForm, useServices } from '@/lib/services';
import { templateFor, withHelp } from '@/form-templates/serviceForm';

function Request({ code }: { code: string }) {
    const { t } = useText();
    const router = useRouter();
    const notify = useNotify();
    const request = useRequestForm(code);
    // the form as this office fills it in: with its overlays when it has any (task 0.21f), else the service's version
    const composed = request.data?.document ?? null;
    const version = useFormVersion(composed ? null : (request.data?.form ?? null));
    const document = composed ?? version.data?.document;
    const fields = useMemo(
        () => (document && request.data ? withHelp(document, request.data.help) : null),
        [document, request.data]
    );
    const [busy, setBusy] = useState(false);

    const filed = (c: { id: string; number: number }) => {
        notify.success(t('services.request.started', { number: String(c.number) }));
        router.push(`/cases/${c.id}`);
    };

    const failed = request.error ?? version.error;
    if (failed) return <p className="text-sm text-destructive">{getApiErrorMessage(failed)}</p>;
    if (!request.data || (request.data.form && !fields)) return <InlineStatus loading className="p-4" />;
    if (!request.data.form)
        return (
            <div className="flex flex-col gap-3" data-request-form="none">
                <p className="text-sm text-muted-foreground">{t('services.request.noForm')}</p>
                <div>
                    <Button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            setBusy(true);
                            fileRequest(code)
                                .then(filed)
                                .catch((error: unknown) => notify.error(getApiErrorMessage(error)))
                                .finally(() => setBusy(false));
                        }}
                    >
                        {t('services.request.start')}
                    </Button>
                </div>
            </div>
        );
    return (
        <div data-request-form={code}>
            <FeeSourceProvider source={{ kind: 'request', serviceCode: code }}>
                <RequestForm code={code} fields={fields ?? []} form={request.data.form} onFiled={filed} />
            </FeeSourceProvider>
        </div>
    );
}

/** The form filled in, filed with the fee it shows (the server refuses a figure that is no longer the fee). */
function RequestForm({
    code,
    fields,
    form,
    onFiled
}: {
    code: string;
    fields: FormField[];
    form: Parameters<typeof templateFor>[0];
    onFiled: (c: { id: string; number: number }) => void;
}) {
    const { t } = useText();
    const fee = useLatestFee();
    const queryClient = useQueryClient();
    return (
        <FormRenderer
            bare
            fields={fields}
            template={templateFor(form, fields)}
            silent
            submitLabel={t('services.request.start')}
            onFormSubmit={async (submission) => {
                // the server validates the answers on the version the service names, and files them with the case
                try {
                    const c = await fileRequest(code, submission.submission_data, fee);
                    onFiled(c);
                    return c;
                } catch (error) {
                    // a fee changed since it was shown is worked out again before the next try
                    await queryClient.invalidateQueries({ queryKey: ['fees'] });
                    throw error;
                }
            }}
        />
    );
}

export function RequestNew({ initial }: { initial?: string }) {
    const { t, text } = useText();
    const services = useServices();
    const offered = (services.data ?? []).filter((s) => s.enabled && s.configured);
    const [code, setCode] = useState<string | undefined>(initial);
    return (
        <div className="flex max-w-3xl flex-col gap-6" data-screen="request-new">
            <PageHeader title={t('services.request.title')} description={t('services.request.intro')} />
            {services.data && offered.length === 0 ? (
                <EmptyState title={t('services.request.none')} />
            ) : (
                <div className="flex max-w-md flex-col gap-2">
                    <Label htmlFor="request-service">{t('services.request.choose')}</Label>
                    <Select value={code} onValueChange={setCode}>
                        <SelectTrigger id="request-service" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {offered.map((s) => (
                                <SelectItem key={s.code} value={s.code}>
                                    {s.code} · {text(s.name)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
            {code && <Request key={code} code={code} />}
        </div>
    );
}
