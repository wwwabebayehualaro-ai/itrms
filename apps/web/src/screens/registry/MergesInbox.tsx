'use client';

/**
 * Merges waiting for a decision (task 0.14, SEC-AC-6): a unit head approves or rejects what a records officer asked.
 * Who asked cannot decide (the API refuses it); the record that stays and the one closed are shown side by side.
 */
import Link from 'next/link';
import { useState } from 'react';
import {
    Alert,
    AlertDescription,
    Button,
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
    EmptyState,
    Input,
    PageHeader,
    PersonName,
    Skeleton
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useText } from '@/lib/preferences';
import { useDecideMerge, useMerges, type Merge } from '@/lib/registry';

export function MergesInbox() {
    const { t } = useText();
    const merges = useMerges('pending');

    return (
        <div className="flex max-w-4xl flex-col gap-6" data-screen="merges">
            <PageHeader title={t('parties.merges.title')} description={t('parties.merges.intro')} />
            {merges.isPending && <Skeleton className="h-32 w-full" />}
            {merges.error && (
                <Alert variant="destructive">
                    <AlertDescription>{getApiErrorMessage(merges.error)}</AlertDescription>
                </Alert>
            )}
            {merges.data?.length === 0 && <EmptyState title={t('parties.merges.none')} />}
            {merges.data?.map((m) => (
                <MergeCard key={m.id} merge={m} />
            ))}
        </div>
    );
}

function MergeCard({ merge }: { merge: Merge }) {
    const { t } = useText();
    const decide = useDecideMerge();
    const [note, setNote] = useState('');
    const person = (p: Merge['survivor']) => (
        <Link href={`/registry/persons/${p.id}`} className="font-medium hover:underline">
            <PersonName ethiopic={p.nameAm} latin={p.nameEn ?? undefined} both />
        </Link>
    );
    return (
        <Card data-merge={merge.id}>
            <CardHeader>
                <CardTitle className="text-base">{merge.reason}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
                <div>
                    <div className="text-muted-foreground text-xs">{t('parties.merges.keep')}</div>
                    {person(merge.survivor)}
                </div>
                <div>
                    <div className="text-muted-foreground text-xs">{t('parties.merges.close')}</div>
                    {person(merge.duplicate)}
                </div>
                <Input
                    className="sm:col-span-2"
                    aria-label={t('parties.merges.note')}
                    placeholder={t('parties.merges.note')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                />
                {decide.error && (
                    <Alert variant="destructive" className="sm:col-span-2">
                        <AlertDescription>{getApiErrorMessage(decide.error)}</AlertDescription>
                    </Alert>
                )}
            </CardContent>
            <CardFooter className="gap-2">
                <Button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ merge, approve: true, note: note || undefined })}
                >
                    {t('parties.merges.approve')}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ merge, approve: false, note: note || undefined })}
                >
                    {t('parties.merges.reject')}
                </Button>
            </CardFooter>
        </Card>
    );
}
