'use client';

/**
 * Fee field (task 0.22a, ADR-0041): the fee the server works out for the service from the answers so far, shown while the
 * form is filled in. It holds no answer; filing works the fee out again and refuses when the figure shown has changed.
 */
import { useId } from 'react';
import { Badge, Button, MoneyText, Skeleton, formatBirr } from '@itrms/ui';
import { formTextIn } from '@itrms/schemas';
import { useFeePreview, useFeeSource, type FeePreview } from '../../host/fees';
import { useEngineText } from '../../host/text';
import { useFieldLabels, useFormValues } from '../FieldTree';
import { defineFieldType, type DisplayFieldProps } from '../kit';

/** Santim text as a bigint (never through a JS number); null for text that is not an amount. */
const santimOf = (text: string | null): bigint | null => (text !== null && /^\d+$/.test(text) ? BigInt(text) : null);

function Amount({ santim }: { santim: string }) {
    const value = santimOf(santim);
    return value === null ? <span>{santim}</span> : <MoneyText santim={value} />;
}

function FeeView({ field }: DisplayFieldProps) {
    const { t, language } = useEngineText();
    const source = useFeeSource();
    const values = useFormValues();
    const labels = useFieldLabels();
    const { preview, isFetching, isError, refetch } = useFeePreview(values);
    const labelId = useId();
    const showLines = field.props.showLines !== false;
    const total = preview?.status === 'complete' ? santimOf(preview.totalSantim) : null;

    const retry = (
        <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
            {t('form-engine.renderer.fee.failed')}
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                {t('form-engine.renderer.fee.retry')}
            </Button>
        </div>
    );
    const muted = (text: string) => <p className="text-sm text-muted-foreground">{text}</p>;

    const body = (p: FeePreview | null) => {
        if (!source) return muted(t('form-engine.renderer.fee.noSource'));
        if (isError || p?.status === 'unavailable') return retry;
        if (!p) return <Skeleton role="img" aria-label={t('form-engine.renderer.fee.loading')} className="h-6 w-32" />;
        switch (p.status) {
            case 'none':
                return muted(t('form-engine.renderer.fee.none'));
            case 'incomplete':
                return muted(
                    t('form-engine.renderer.fee.incomplete', {
                        fields: p.missing.map((key) => labels.get(key) || key).join(', ')
                    })
                );
            case 'complete':
                return (
                    <div className="flex flex-col gap-1 text-sm">
                        {showLines &&
                            p.lines.map((line) => (
                                <div key={line.key} className="flex justify-between gap-4">
                                    <span>{formTextIn(line.label, language) ?? line.key}</span>
                                    <Amount santim={line.amountSantim} />
                                </div>
                            ))}
                        <div className="flex justify-between gap-4 font-medium">
                            <span>{t('form-engine.renderer.fee.total')}</span>
                            {p.totalSantim !== null && <Amount santim={p.totalSantim} />}
                        </div>
                    </div>
                );
            default:
                return retry;
        }
    };

    return (
        <div
            role="group"
            aria-labelledby={labelId}
            aria-busy={isFetching}
            className="flex flex-col gap-2 rounded-md border p-3"
            data-field-fee={field.id}
        >
            <div className="flex items-center justify-between gap-2">
                <span id={labelId} className="text-sm font-medium">
                    {field.label || t('form-engine.renderer.fee.label')}
                </span>
                {preview?.demo && <Badge variant="outline">{t('form-engine.renderer.fee.demo')}</Badge>}
            </div>
            {body(preview)}
            {/* announces the total once, not every line */}
            <span role="status" aria-live="polite" className="sr-only">
                {total !== null && !isFetching ? `${t('form-engine.renderer.fee.total')} ${formatBirr(total)}` : ''}
            </span>
        </div>
    );
}

defineFieldType({ kind: 'display', type: 'Fee', Render: FeeView });
