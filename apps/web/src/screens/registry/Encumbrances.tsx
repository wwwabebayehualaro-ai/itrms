'use client';

/**
 * The encumbrances the active office recorded (task 1.4a): releases waiting for a second person first, then the open ones. The
 * office's list is its subtree's; a vehicle's own tab shows every hold on it, whichever office recorded it.
 */
import { Alert, AlertDescription, PageHeader, Skeleton } from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useOfficeEncumbrances } from '@/lib/encumbrances';
import { useText } from '@/lib/preferences';

import { EncumbranceTable } from './EncumbrancePanel';

export function Encumbrances() {
    const { t } = useText();
    const pending = useOfficeEncumbrances('release_pending');
    const open = useOfficeEncumbrances('open');
    const failed = pending.error ?? open.error;
    return (
        <div className="flex flex-col gap-6" data-screen="encumbrances">
            <PageHeader title={t('vehicles.encumbrance.title')} description={t('vehicles.encumbrance.intro')} />
            {failed && (
                <Alert variant="destructive">
                    <AlertDescription>
                        {getApiErrorMessage(failed, t('vehicles.encumbrance.loadFailed'))}
                    </AlertDescription>
                </Alert>
            )}
            {(pending.isPending || open.isPending) && <Skeleton className="h-24 w-full" />}
            {pending.data && open.data && <EncumbranceTable items={[...pending.data, ...open.data]} vehicleLink />}
        </div>
    );
}
