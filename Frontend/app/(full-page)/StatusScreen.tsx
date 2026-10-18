import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@platform/ui';

/** A full-page message outside the app frame (access denied, error, not found) with a way back. */
export function StatusScreen({ icon: Icon, code, title, message, children }: { icon: LucideIcon; code?: string; title: string; message: string; children?: React.ReactNode }) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6" data-status-screen>
            <div className="flex max-w-md flex-col items-center gap-4 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="size-7" aria-hidden="true" />
                </span>
                {code && <span className="text-sm font-semibold tracking-widest text-primary">{code}</span>}
                <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
                <p className="text-muted-foreground">{message}</p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {children}
                    <Button asChild>
                        <Link href="/">
                            <ArrowLeft />
                            Go to the dashboard
                        </Link>
                    </Button>
                </div>
            </div>
        </main>
    );
}
