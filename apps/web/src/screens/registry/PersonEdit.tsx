'use client';

import { Alert, AlertDescription, Skeleton } from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useText } from '@/lib/preferences';
import { usePerson } from '@/lib/registry';
import { PersonForm } from './PersonForm';

/** A correction of a person: the form, filled from the record once it is loaded. */
export function PersonEdit({ id }: { id: string }) {
    const { t } = useText();
    const person = usePerson(id);
    if (person.isPending) return <Skeleton className="h-48 w-full" />;
    if (!person.data)
        return (
            <Alert variant="destructive">
                <AlertDescription>{getApiErrorMessage(person.error, t('parties.record.notFound'))}</AlertDescription>
            </Alert>
        );
    return <PersonForm person={person.data} />;
}
