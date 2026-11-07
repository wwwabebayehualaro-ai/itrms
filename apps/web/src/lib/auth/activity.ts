/**
 * Whether the person is at the page (SEC-SE-2; security review 0.26c1 A1). The session's 30-minute idle timeout counts
 * their own activity, never the page's polling: a read made with no keyboard or pointer input in the last minute is the
 * page's own (the HTTP client marks it, and the BFF does not restart the idle timeout for it). Someone typing a long form
 * makes no request for many minutes: while they are at the page, a ping every few minutes keeps their session.
 */
import { CSRF_HEADER } from './cookies';
import { session } from './session';

/** Input this recent makes a read the person's. */
export const ACTIVE_MS = 60_000;
/** A person at the page without a request of their own is pinged for this often. */
export const PING_MS = 4 * 60_000;

export interface ActivityClock {
    lastInput: number;
    lastPing: number;
}

const clock: ActivityClock = { lastInput: Date.now(), lastPing: Date.now() };

/** The person's own input, now. */
export const markInput = (at = Date.now(), state = clock) => {
    state.lastInput = at;
};

/** Whether a read now is the person's: input in the last minute. */
export const personActive = (at = Date.now(), state = clock) => at - state.lastInput < ACTIVE_MS;

/** A request of the person's went out: the BFF's idle timeout was restarted by it. */
export const markSent = (at = Date.now(), state = clock) => {
    state.lastPing = at;
};

/** Whether the person was at the page since the last request of theirs, and that is long enough ago to tell the BFF. */
export const pingDue = (at = Date.now(), state = clock) =>
    state.lastInput > state.lastPing && at - state.lastPing >= PING_MS;

const INPUT_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

/** Follows the person's input on this page and pings the BFF while they work without requests; returns the undo. */
export function trackActivity(): () => void {
    const onInput = () => markInput();
    for (const name of INPUT_EVENTS) window.addEventListener(name, onInput, { passive: true, capture: true });
    const timer = window.setInterval(() => {
        if (!pingDue()) return;
        markSent();
        void fetch('/auth/activity', { method: 'POST', headers: { [CSRF_HEADER]: session.csrfToken() ?? '' } }).catch(
            () => undefined
        );
    }, 30_000);
    return () => {
        for (const name of INPUT_EVENTS) window.removeEventListener(name, onInput, { capture: true });
        window.clearInterval(timer);
    };
}
