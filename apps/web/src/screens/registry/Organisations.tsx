'use client';

/**
 * The register of organisations (task 0.14): search by name or TIN, register one, and see one with its members (a member
 * is a person of the register, found by name).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MEMBER_ROLES, ORGANISATION_KINDS } from '@itrms/parties/contracts';
import {
    Alert,
    AlertDescription,
    Button,
    DescriptionList,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    EmptyState,
    Input,
    Label,
    PageHeader,
    PersonName,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/auth/authStore';
import { useText } from '@/lib/preferences';
import {
    useAddMember,
    useCreateOrganisation,
    useOrganisation,
    useOrganisations,
    usePersonSearch
} from '@/lib/registry';

export function OrganisationsList() {
    const { t, text } = useText();
    const [q, setQ] = useState('');
    const list = useOrganisations(q);
    const canCreate = useAuthStore((s) => s.workspace?.permissions.includes('organisation:create') ?? false);

    return (
        <div className="flex flex-col gap-6" data-screen="organisations">
            <PageHeader
                title={t('parties.organisations.title')}
                description={t('parties.organisations.intro')}
                actions={canCreate && <NewOrganisation />}
            />
            <Input
                aria-label={t('parties.organisations.search')}
                placeholder={t('parties.organisations.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
            />
            {list.isPending && <Skeleton className="h-24 w-full" />}
            {list.data?.length === 0 && <EmptyState variant="no-results" title={t('parties.organisations.none')} />}
            {list.data && list.data.length > 0 && (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('parties.field.name')}</TableHead>
                            <TableHead>{t('parties.field.kind')}</TableHead>
                            <TableHead>{t('parties.field.tin')}</TableHead>
                            <TableHead>{t('parties.field.handlingUnit')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {list.data.map((o) => (
                            <TableRow key={o.id}>
                                <TableCell>
                                    <Link
                                        href={`/registry/organisations/${o.id}`}
                                        className="font-medium hover:underline"
                                    >
                                        {text(o.name)}
                                    </Link>
                                </TableCell>
                                <TableCell>{t(`parties.kind.${o.kind}`)}</TableCell>
                                <TableCell className="font-mono">{o.tin ?? '—'}</TableCell>
                                <TableCell>{text({ am: '', en: '', ...o.handlingUnit.name })}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}

function NewOrganisation() {
    const { t } = useText();
    const router = useRouter();
    const create = useCreateOrganisation();
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<(typeof ORGANISATION_KINDS)[number]>('association');
    const [am, setAm] = useState('');
    const [en, setEn] = useState('');
    const [tin, setTin] = useState('');
    return (
        <>
            <Button type="button" onClick={() => setOpen(true)}>
                {t('parties.organisations.new')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('parties.organisations.new')}</DialogTitle>
                    </DialogHeader>
                    <form
                        className="flex flex-col gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            create.mutate(
                                { kind, name: { am: am.trim(), en: en.trim() }, tin: tin.trim() || undefined },
                                { onSuccess: (o) => router.push(`/registry/organisations/${o.id}`) }
                            );
                        }}
                    >
                        <Label htmlFor="org-kind">{t('parties.field.kind')}</Label>
                        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                            <SelectTrigger id="org-kind">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {ORGANISATION_KINDS.map((k) => (
                                    <SelectItem key={k} value={k}>
                                        {t(`parties.kind.${k}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Label htmlFor="org-am">{t('parties.organisations.nameAm')}</Label>
                        <Input id="org-am" ethiopic lang="am" value={am} onChange={(e) => setAm(e.target.value)} />
                        <Label htmlFor="org-en">{t('parties.organisations.nameEn')}</Label>
                        <Input id="org-en" lang="en" value={en} onChange={(e) => setEn(e.target.value)} />
                        <Label htmlFor="org-tin">{t('parties.field.tin')}</Label>
                        <Input id="org-tin" inputMode="numeric" value={tin} onChange={(e) => setTin(e.target.value)} />
                        {create.error && (
                            <Alert variant="destructive">
                                <AlertDescription>{getApiErrorMessage(create.error)}</AlertDescription>
                            </Alert>
                        )}
                        <DialogFooter>
                            <Button type="submit" disabled={!am.trim() || !en.trim() || create.isPending}>
                                {t('parties.form.register')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}

export function OrganisationRecord({ id }: { id: string }) {
    const { t, text } = useText();
    const organisation = useOrganisation(id);
    const canUpdate = useAuthStore((s) => s.workspace?.permissions.includes('organisation:update') ?? false);
    if (organisation.isPending) return <Skeleton className="h-48 w-full" />;
    if (!organisation.data)
        return (
            <Alert variant="destructive">
                <AlertDescription>
                    {getApiErrorMessage(organisation.error, t('parties.record.notFound'))}
                </AlertDescription>
            </Alert>
        );
    const o = organisation.data;
    return (
        <div className="flex max-w-4xl flex-col gap-6" data-screen="organisation-record">
            <PageHeader
                title={text(o.name)}
                meta={t('parties.record.handledBy', { unit: text({ am: '', en: '', ...o.handlingUnit.name }) })}
                actions={canUpdate && <AddMember id={o.id} />}
            />
            <DescriptionList
                items={[
                    { term: t('parties.field.kind'), value: t(`parties.kind.${o.kind}`) },
                    { term: t('parties.field.tin'), value: o.tin },
                    { term: t('parties.field.licenceNumber'), value: o.licenceNumber }
                ]}
            />
            <section className="flex flex-col gap-2">
                <h2 className="font-medium">{t('parties.organisations.members')}</h2>
                {o.members.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t('parties.organisations.noMembers')}</p>
                ) : (
                    <Table>
                        <TableBody>
                            {o.members.map((m) => (
                                <TableRow key={m.id}>
                                    <TableCell>
                                        <Link href={`/registry/persons/${m.person.id}`} className="hover:underline">
                                            <PersonName
                                                ethiopic={m.person.nameAm}
                                                latin={m.person.nameEn ?? undefined}
                                            />
                                        </Link>
                                    </TableCell>
                                    <TableCell>{t(`parties.role.${m.role}`)}</TableCell>
                                    <TableCell>{m.until ? t('parties.organisations.ended') : ''}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </section>
        </div>
    );
}

function AddMember({ id }: { id: string }) {
    const { t } = useText();
    const add = useAddMember(id);
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [role, setRole] = useState<(typeof MEMBER_ROLES)[number]>('member');
    const found = usePersonSearch(open ? q : '');
    return (
        <>
            <Button type="button" variant="outline" onClick={() => setOpen(true)}>
                {t('parties.organisations.addMember')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('parties.organisations.addMember')}</DialogTitle>
                    </DialogHeader>
                    <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                        <SelectTrigger aria-label={t('parties.organisations.role')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {MEMBER_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                    {t(`parties.role.${r}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Input
                        aria-label={t('parties.persons.byName')}
                        placeholder={t('parties.persons.namePlaceholder')}
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                    <ul className="flex max-h-56 flex-col gap-1 overflow-auto">
                        {(found.data ?? [])
                            .filter((p) => p.status === 'active')
                            .map((p) => (
                                <li key={p.id} className="flex items-center justify-between gap-2">
                                    <PersonName ethiopic={p.nameAm} latin={p.nameEn ?? undefined} both />
                                    <Button
                                        type="button"
                                        size="sm"
                                        disabled={add.isPending}
                                        onClick={() =>
                                            add.mutate({ personId: p.id, role }, { onSuccess: () => setOpen(false) })
                                        }
                                    >
                                        {t('parties.organisations.add')}
                                    </Button>
                                </li>
                            ))}
                    </ul>
                    {add.error && (
                        <Alert variant="destructive">
                            <AlertDescription>{getApiErrorMessage(add.error)}</AlertDescription>
                        </Alert>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
