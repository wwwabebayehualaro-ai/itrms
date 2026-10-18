'use client';

import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Toaster } from '../primitives/sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../primitives/alert-dialog';
import { buttonVariants } from '../primitives/button';
import { confirmStore } from '../feedback/confirmAction';

/** A notification. `severity` picks the look; `summary` is the title, `detail` the text; `life` in ms. */
export interface ToastMessage {
    severity?: 'success' | 'info' | 'warn' | 'error' | 'secondary' | 'contrast';
    summary?: React.ReactNode;
    detail?: React.ReactNode;
    life?: number;
}

export interface NotifyApi {
    show: (message: ToastMessage | ToastMessage[]) => void;
    success: (detail: string, summary?: string) => void;
    error: (detail: string, summary?: string) => void;
    warn: (detail: string, summary?: string) => void;
    info: (detail: string, summary?: string) => void;
}

const NotifyContext = createContext<NotifyApi | null>(null);

const showOne = ({ severity, summary, detail, life }: ToastMessage) => {
    // the summary is a generic word ("Success", "Error") in most calls: the detail is what people read
    const title = detail ?? summary;
    const description = detail !== undefined && summary !== undefined && !['Success', 'Error', 'Warning', 'Info'].includes(String(summary)) ? summary : undefined;
    const options = { description, duration: life };
    if (severity === 'success') toast.success(title, options);
    else if (severity === 'error') toast.error(title, options);
    else if (severity === 'warn') toast.warning(title, options);
    else if (severity === 'info') toast.info(title, options);
    else toast(title, options);
};

const API: NotifyApi = {
    show: (m) => (Array.isArray(m) ? m : [m]).forEach(showOne),
    success: (detail, summary) => showOne({ severity: 'success', summary, detail, life: 3000 }),
    error: (detail, summary) => showOne({ severity: 'error', summary, detail, life: 6000 }),
    warn: (detail, summary) => showOne({ severity: 'warn', summary, detail, life: 6000 }),
    info: (detail, summary) => showOne({ severity: 'info', summary, detail, life: 3000 })
};

/** The one confirmation dialog of the app: shows what `confirmAction()` asks. */
function ConfirmHost() {
    const c = useSyncExternalStore(confirmStore.subscribe, confirmStore.get, () => null);
    return (
        <AlertDialog open={!!c} onOpenChange={(open) => !open && confirmStore.settle(false)}>
            {c && (
                <AlertDialogContent data-confirm>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{c.header ?? 'Are you sure?'}</AlertDialogTitle>
                        <AlertDialogDescription>{c.message}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => confirmStore.settle(false)}>{c.rejectLabel ?? 'Cancel'}</AlertDialogCancel>
                        <AlertDialogAction className={c.danger ? buttonVariants({ variant: 'destructive' }) : undefined} onClick={() => confirmStore.settle(true)}>
                            {c.acceptLabel ?? 'Continue'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            )}
        </AlertDialog>
    );
}

/**
 * The one toaster and the one confirmation dialog of the whole app (mounted in the root layout).
 * Pages never render their own: they use `useNotify()` and `confirmAction()`.
 */
export function NotifyProvider({ children }: { children: React.ReactNode }) {
    return (
        <NotifyContext.Provider value={API}>
            {children}
            <Toaster position="top-right" richColors closeButton />
            <ConfirmHost />
        </NotifyContext.Provider>
    );
}

export function useNotify(): NotifyApi {
    const ctx = useContext(NotifyContext);
    if (!ctx) throw new Error('useNotify must be used inside <NotifyProvider>');
    return ctx;
}

/** For older code that calls `toast.current?.show(...)`: the same notifications through a ref-shaped object. */
export function useToastRef(): React.RefObject<{ show: NotifyApi['show']; clear: () => void; replace: NotifyApi['show'] }> {
    const { show } = useNotify();
    return useMemo(() => ({ current: { show, clear: () => undefined, replace: show } }), [show]);
}
