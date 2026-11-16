'use client';

/**
 * The home page's campaign widget (task 1.13i): each open campaign's count of today and so far against its target, for the offices
 * the person's unit sees. The detail screen has the offices and their days.
 */
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
    Button,
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Skeleton,
    StatusBadge
} from '@itrms/ui';

import { useCampaignProgresses, useCampaigns } from '@/lib/campaigns';
import { useText } from '@/lib/preferences';

/** the open campaigns the widget shows */
const SHOWN = 3;

export function CampaignWidget() {
    const { t, text } = useText();
    const list = useCampaigns();
    const open = (list.data?.items ?? []).filter((c) => c.closedAt === null).slice(0, SHOWN);
    const progresses = useCampaignProgresses(open.map((c) => c.id));
    return (
        <Card data-widget="campaigns">
            <CardHeader>
                <CardTitle>{t('competency.campaign.widget.title')}</CardTitle>
                <CardDescription>{t('competency.campaign.widget.intro')}</CardDescription>
                <CardAction>
                    <Button asChild variant="ghost" size="sm">
                        <Link href="/competency/campaigns">
                            {t('competency.campaign.widget.all')}
                            <ArrowRight />
                        </Link>
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent>
                {list.isPending ? (
                    <Skeleton className="h-16 w-full" />
                ) : open.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {t('competency.campaign.widget.empty')}
                    </p>
                ) : (
                    <ul className="divide-y">
                        {open.map((c, i) => {
                            const progress = progresses[i]?.data;
                            return (
                                <li key={c.id} data-campaign={c.id} data-kind={c.kind}>
                                    <Link
                                        href={`/competency/campaigns/${c.id}`}
                                        className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50"
                                    >
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate text-sm font-medium">
                                                {text({ am: '', en: '', ...c.name })}
                                            </span>
                                            <span className="truncate text-xs text-muted-foreground" data-campaign-line>
                                                {progress
                                                    ? t('competency.campaign.widget.line', {
                                                          today: String(progress.total.today),
                                                          total: String(progress.total.total),
                                                          target:
                                                              progress.total.target === null
                                                                  ? '—'
                                                                  : String(progress.total.target)
                                                      })
                                                    : '…'}
                                            </span>
                                        </span>
                                        {progress && progress.total.expected !== null && (
                                            <StatusBadge
                                                value={
                                                    progress.total.total >= progress.total.expected
                                                        ? 'on-track'
                                                        : 'behind'
                                                }
                                                tone={
                                                    progress.total.total >= progress.total.expected
                                                        ? 'success'
                                                        : 'warning'
                                                }
                                                label={t(
                                                    progress.total.total >= progress.total.expected
                                                        ? 'competency.campaign.onTrack'
                                                        : 'competency.campaign.behind'
                                                )}
                                            />
                                        )}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
