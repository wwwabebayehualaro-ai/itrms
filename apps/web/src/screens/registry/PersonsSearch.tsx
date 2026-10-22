'use client';

/**
 * The register of persons (task 0.14): search by name in either script (Ethiopic typing with F9), or by an exact FIN or
 * phone. The region's persons are found from any of its offices; a sensitive value is sent in a request body, never in
 * the address bar.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
    Button,
    EmptyState,
    Input,
    Label,
    PageHeader,
    PersonName,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    ToggleGroup,
    ToggleGroupItem
} from '@itrms/ui';

import { useAuthStore } from '@/lib/auth/authStore';
import { useText } from '@/lib/preferences';
import { usePersonLookup, usePersonSearch, type PersonSummary } from '@/lib/registry';

type Mode = 'name' | 'fin' | 'phone';

export function PersonsSearch() {
    const { t, text } = useText();
    const router = useRouter();
    const params = useSearchParams();
    const canCreate = useAuthStore((s) => s.workspace?.permissions.includes('person:create') ?? false);
    // a lookup by FIN or phone is for intake (person:lookup), and each one is recorded
    const canLookUp = useAuthStore((s) => s.workspace?.permissions.includes('person:lookup') ?? false);
    const [mode, setMode] = useState<Mode>('name');
    // the name searched is in the address (a view can be shared); a FIN or phone never is
    const q = params.get('q') ?? '';
    const [typed, setTyped] = useState(q);
    const [exact, setExact] = useState('');
    const byName = usePersonSearch(mode === 'name' ? q : '');
    const lookup = usePersonLookup();

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (mode === 'name') router.replace(`/registry/persons?q=${encodeURIComponent(typed.trim())}`);
        else lookup.mutate(mode === 'fin' ? { fin: exact } : { phone: exact });
    };

    const rows: PersonSummary[] | undefined = mode === 'name' ? byName.data : lookup.data;
    const loading = mode === 'name' ? byName.isFetching : lookup.isPending;
    const searched = mode === 'name' ? q.trim().length >= 2 : lookup.isSuccess;

    return (
        <div className="flex flex-col gap-6" data-screen="persons-search">
            <PageHeader
                title={t('parties.persons.title')}
                description={t('parties.persons.intro')}
                actions={
                    canCreate && (
                        <Button asChild>
                            <Link href="/registry/persons/new">{t('parties.action.newPerson')}</Link>
                        </Button>
                    )
                }
            />
            <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end" role="search">
                <ToggleGroup
                    type="single"
                    variant="outline"
                    value={mode}
                    onValueChange={(v) => v && setMode(v as Mode)}
                    aria-label={t('parties.persons.searchBy')}
                >
                    <ToggleGroupItem value="name">{t('parties.persons.byName')}</ToggleGroupItem>
                    {canLookUp && <ToggleGroupItem value="fin">{t('parties.field.fin')}</ToggleGroupItem>}
                    {canLookUp && <ToggleGroupItem value="phone">{t('parties.field.phone')}</ToggleGroupItem>}
                </ToggleGroup>
                <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor="person-search" className="sr-only">
                        {t('parties.persons.searchBy')}
                    </Label>
                    {mode === 'name' ? (
                        <Input
                            id="person-search"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            placeholder={t('parties.persons.namePlaceholder')}
                            autoComplete="off"
                        />
                    ) : (
                        <Input
                            id="person-search"
                            inputMode="numeric"
                            value={exact}
                            onChange={(e) => setExact(e.target.value)}
                            placeholder={t(mode === 'fin' ? 'parties.field.finHint' : 'parties.field.phoneHint')}
                            autoComplete="off"
                        />
                    )}
                </div>
                <Button type="submit">{t('parties.persons.search')}</Button>
            </form>

            {loading && <Skeleton className="h-24 w-full" />}
            {!loading && searched && rows?.length === 0 && (
                <EmptyState title={t('parties.persons.none')} description={t('parties.persons.noneHint')} />
            )}
            {!loading && rows && rows.length > 0 && (
                <Table data-results>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('parties.field.name')}</TableHead>
                            <TableHead>{t('parties.field.sex')}</TableHead>
                            <TableHead>{t('parties.field.birthYear')}</TableHead>
                            <TableHead>{t('parties.field.handlingUnit')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((p) => (
                            <TableRow key={p.id} data-person={p.id}>
                                <TableCell>
                                    <Link href={`/registry/persons/${p.id}`} className="font-medium hover:underline">
                                        <PersonName ethiopic={p.nameAm} latin={p.nameEn ?? undefined} both />
                                    </Link>
                                    {p.status === 'merged' && (
                                        <span className="text-muted-foreground ms-2 text-xs">
                                            {t('parties.persons.merged')}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell>{t(`parties.sex.${p.sex}`)}</TableCell>
                                <TableCell>{p.birthYear ?? '—'}</TableCell>
                                <TableCell>{text({ am: '', en: '', ...p.handlingUnit.name })}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
