'use client';

/**
 * The service catalogue (task 0.21c): the region's services by work process, which are configured (their version in
 * use) and which the office the person acts for offers. A service opens its versions, the publishing of a new one, and
 * the offices' configuration.
 */
import Link from 'next/link';
import {
    Badge,
    Button,
    EmptyState,
    PageHeader,
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useText } from '@/lib/preferences';
import { useServices } from '@/lib/services';

export function ServicesCatalogue() {
    const { t, text } = useText();
    const services = useServices();
    return (
        <div className="flex flex-col gap-6" data-screen="services">
            <PageHeader title={t('services.catalogue.title')} description={t('services.catalogue.intro')} />
            {services.error ? (
                <p className="text-sm text-destructive">{getApiErrorMessage(services.error)}</p>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('services.catalogue.code')}</TableHead>
                            <TableHead>{t('services.catalogue.name')}</TableHead>
                            <TableHead>{t('services.catalogue.state')}</TableHead>
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {services.isPending && (
                            <TableRow>
                                <TableCell colSpan={4}>
                                    <Skeleton className="h-6 w-full" />
                                </TableCell>
                            </TableRow>
                        )}
                        {services.data?.map((s) => (
                            <TableRow key={s.code} data-service={s.code}>
                                <TableCell className="font-mono text-xs">{s.code}</TableCell>
                                <TableCell className="max-w-xl">{text(s.name)}</TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        <Badge
                                            variant={s.configured ? 'default' : 'outline'}
                                            data-configured={s.configured}
                                        >
                                            {s.configured && s.currentVersion !== null
                                                ? t('services.catalogue.configured', {
                                                      number: String(s.currentVersion)
                                                  })
                                                : t('services.catalogue.notConfigured')}
                                        </Badge>
                                        <Badge variant="outline">
                                            {t(
                                                s.enabled
                                                    ? 'services.catalogue.offered'
                                                    : 'services.catalogue.notOffered'
                                            )}
                                        </Badge>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button asChild size="sm" variant="outline">
                                        <Link href={`/services/${s.code}`}>{t('services.catalogue.open')}</Link>
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            {services.data?.length === 0 && <EmptyState title={t('services.catalogue.empty')} />}
        </div>
    );
}
