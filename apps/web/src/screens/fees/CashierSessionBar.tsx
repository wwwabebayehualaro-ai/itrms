'use client';

/**
 * The cashier's session on the queue page (task 1.12, ADR-0063): today's open session with its figures and a way to count
 * the till, or a way to open it with a float (the first payment opens it with none). An earlier day's session not yet
 * closed is shown as overdue; it blocks nothing.
 */
import Link from 'next/link';
import { useState } from 'react';
import { Button, Field, FieldLabel, MoneyInput, StatusBadge, useNotify } from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { useCurrentSessions, useOpenSession } from '@/lib/fees';
import { formatDay, formatMoney } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';

export function CashierSessionBar() {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const notify = useNotify();
    const mayOpen = useCan('cashier-session:open');
    const current = useCurrentSessions();
    const open = useOpenSession();
    const [float, setFloat] = useState<bigint | null>(null);

    if (current.isPending || current.error) return null;
    const { today, overdue } = current.data;
    // the newest of today that is still open, else the newest of the day
    const active = today.find((s) => s.state === 'open') ?? today[0];

    return (
        <section
            className="flex flex-col gap-3 rounded-md border p-4"
            data-session-bar
            data-session-state={active?.state ?? 'none'}
        >
            <h2 className="font-medium">{t('fees.session.bar.title')}</h2>
            {overdue.map((s) => (
                <p key={s.id} className="text-destructive text-sm" data-overdue-session={s.id}>
                    {t('fees.session.bar.overdue', { day: formatDay(s.businessDay, { language, calendar }) })}{' '}
                    <Link href={`/cashier/sessions/${s.id}`} className="underline">
                        {t('fees.session.bar.count')}
                    </Link>
                </p>
            ))}
            {active ? (
                <div className="flex flex-wrap items-center gap-4 text-sm">
                    <StatusBadge
                        value={active.state}
                        tone={active.state === 'closed' ? 'success' : active.state === 'open' ? 'info' : 'warning'}
                        label={t(`fees.session.state.${active.state}`)}
                    />
                    <span>
                        {t('fees.session.bar.summary', {
                            receipts: String(active.receiptCount),
                            expected: formatMoney(active.expectedCashSantim, language)
                        })}
                    </span>
                    <Button asChild size="sm" variant="outline">
                        <Link href={`/cashier/sessions/${active.id}`} data-action="open-session-page">
                            {active.state === 'open' ? t('fees.session.bar.count') : t('fees.session.bar.view')}
                        </Link>
                    </Button>
                </div>
            ) : (
                <p className="text-muted-foreground text-sm">{t('fees.session.bar.none')}</p>
            )}
            {mayOpen && !today.some((s) => s.state === 'open') && (
                <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        open.mutate(
                            { openingFloatSantim: (float ?? 0n).toString() },
                            { onSuccess: () => notify.success(t('fees.session.bar.opened')) }
                        );
                    }}
                >
                    <Field>
                        <FieldLabel htmlFor="session-float">{t('fees.session.bar.float')}</FieldLabel>
                        <MoneyInput
                            id="session-float"
                            unit={t('common.money.unit')}
                            refusedMessage={t('common.money.refused')}
                            value={float}
                            onValueChange={setFloat}
                        />
                    </Field>
                    <Button type="submit" variant="outline" disabled={open.isPending} data-action="open-session">
                        {t('fees.session.bar.open')}
                    </Button>
                    {open.error && (
                        <p className="text-destructive text-sm" role="alert">
                            {getApiErrorMessage(open.error)}
                        </p>
                    )}
                </form>
            )}
        </section>
    );
}
