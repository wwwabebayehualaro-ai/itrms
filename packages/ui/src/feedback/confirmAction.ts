/**
 * Confirmations as a plain function call (`await confirmAction({...})`): the request goes into a small external store and the one
 * `ConfirmHost` (mounted by `NotifyProvider`) shows it as a design-system AlertDialog. One confirmation at a time; a new one
 * replaces (and declines) a pending one.
 */
export interface ConfirmOptions {
    message: string;
    header?: string;
    /** Styles the accept button as destructive. */
    danger?: boolean;
    acceptLabel?: string;
    rejectLabel?: string;
    /** Callback style, for call sites that do not await the promise. */
    onAccept?: () => void | Promise<void>;
    onReject?: () => void;
}

export interface PendingConfirm extends ConfirmOptions {
    id: number;
    resolve: (accepted: boolean) => void;
}

let current: PendingConfirm | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const confirmStore = {
    get: () => current,
    subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => void listeners.delete(fn);
    },
    /** Settle the pending confirmation (accept / decline) and close it. */
    settle: (accepted: boolean) => {
        const c = current;
        if (!c) return;
        current = null;
        emit();
        c.resolve(accepted);
        if (accepted) void c.onAccept?.();
        else c.onReject?.();
    }
};

/** Promise-based confirmation. Resolves `true` when accepted, `false` when declined or dismissed. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
    if (current) confirmStore.settle(false);
    return new Promise((resolve) => {
        current = { ...options, id: nextId++, resolve };
        emit();
    });
}
