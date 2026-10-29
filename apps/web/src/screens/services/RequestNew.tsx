'use client';

/**
 * A request at the counter (task 0.21c): the services the office offers and that are configured; the chosen service's
 * request form (the version its configuration names, with the help texts set for this office), filled and filed with
 * the new case in one transaction (`POST /api/v1/service-requests`, validated on the server); then the case page.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormRenderer } from '@itrms/form-engine/renderer';
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
import { withHelp } from '@/form-templates/serviceForm';

function Request({ code }: { code: string }) {
    const { t } = useText();
    const router = useRouter();
    const notify = useNotify();
    const request = useRequestForm(code);
    const version = useFormVersion(request.data?.form ?? null);
    const fields = useMemo(
        () => (version.data && request.data ? withHelp(version.data.document, request.data.help) : null),
        [version.data, request.data]
    );
    const [busy, setBusy] = useState(false);

    const filed = (c: { id: string; number: number }) => {
        notify.success(t('services.request.started', { number: String(c.number) }));
        router.push(`/cases/${c.id}`);
    };

    if (request.error) return <p className="text-sm text-destructive">{getApiErrorMessage(request.error)}</p>;
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
            <FormRenderer
                bare
                fields={fields ?? []}
                silent
                submitLabel={t('services.request.start')}
                onFormSubmit={async (submission) => {
                    // the server validates the answers on the version the service names, and files them with the case
                    const c = await fileRequest(code, submission.submission_data);
                    filed(c);
                    return c;
                }}
            />
        </div>
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
