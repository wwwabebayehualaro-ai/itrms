import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const subscribe = (onChange: () => void) => {
    const mql = window.matchMedia(QUERY);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
};

/** True below the phone breakpoint; read from the media query as an external store (false while rendering on the server). */
export function useIsMobile() {
    return React.useSyncExternalStore(
        subscribe,
        () => window.matchMedia(QUERY).matches,
        () => false
    );
}
