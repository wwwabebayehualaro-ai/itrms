/**
 * A polite live region for short announcements (task 0.17d): one per page, created on first use, visually hidden. The
 * text is cleared and set again on the next frame, so the same announcement twice is read twice. Its styles are set
 * through the CSSOM, which a strict CSP allows (no style attribute in markup).
 */
let region: HTMLElement | null = null;

function liveRegion(): HTMLElement {
    if (region?.isConnected) return region;
    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('data-announcer', '');
    Object.assign(el.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: '0'
    });
    document.body.appendChild(el);
    region = el;
    return el;
}

/** Says `text` to screen readers without moving the focus. */
export function announce(text: string): void {
    if (typeof document === 'undefined') return;
    const el = liveRegion();
    el.textContent = '';
    requestAnimationFrame(() => (el.textContent = text));
}
