'use client';

/**
 * The notifications bell (task 0.20b): how many are unread, the newest ones, and where each leads (its case, the form
 * whose export it is about). Opening one marks it read; "mark all read" does the rest.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@itrms/ui';

import { formatMoment } from '@/lib/format';
import { noticeHref, useMarkRead, useNotices, type Notice } from '@/lib/notifications';
import { usePreferences, useText } from '@/lib/preferences';

export function NotificationsBell() {
    const { t, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const router = useRouter();
    const notices = useNotices();
    const markRead = useMarkRead();
    const [open, setOpen] = useState(false);
    const items = notices.data ?? [];
    const unread = items.filter((n) => !n.read);
    const textOf = (n: Notice) => n.text[language] ?? n.text.am ?? n.text.en ?? n.key;

    const follow = (n: Notice) => {
        if (!n.read) markRead.mutate([n.id]);
        const href = noticeHref(n);
        setOpen(false);
        if (href) router.push(href);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    aria-label={
                        unread.length
                            ? t('shell.notifications.unread', { count: String(unread.length) })
                            : t('shell.notifications.title')
                    }
                    data-notifications-bell
                    data-unread={unread.length}
                >
                    <Bell />
                    {unread.length > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] font-semibold text-white">
                            {unread.length > 9 ? '9+' : unread.length}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0" data-notifications>
                <div className="flex items-center justify-between border-b px-3 py-2">
                    <h2 className="text-sm font-medium">{t('shell.notifications.title')}</h2>
                    {unread.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={markRead.isPending}
                            onClick={() => markRead.mutate(unread.map((n) => n.id))}
                        >
                            {t('shell.notifications.markAll')}
                        </Button>
                    )}
                </div>
                {items.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {t('shell.notifications.empty')}
                    </p>
                ) : (
                    <ul className="max-h-96 overflow-y-auto">
                        {items.map((n) => (
                            <li key={n.id}>
                                <button
                                    type="button"
                                    className="flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                                    onClick={() => follow(n)}
                                    data-notice={n.key}
                                    data-read={n.read}
                                >
                                    <span
                                        aria-hidden
                                        className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-primary'}`}
                                    />
                                    <span className="flex flex-col gap-0.5">
                                        <span className={n.read ? 'text-muted-foreground' : ''}>{textOf(n)}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatMoment(n.at, { language, calendar })}
                                            {!n.read && (
                                                <span className="sr-only"> · {t('shell.notifications.new')}</span>
                                            )}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </PopoverContent>
        </Popover>
    );
}
