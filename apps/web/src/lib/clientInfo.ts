// utils/clientInfo.ts
// The client IP is not collected in the browser: the backend records it from the request (audit trail).

// utils/clientInfo.ts
export const getDeviceInfo = (): Record<string, unknown> => {
    if (typeof window === 'undefined') return {}; // Server-side rendering

    const userAgent = navigator.userAgent;
    const screen = window.screen;

    return {
        userAgent,
        screen: {
            width: screen.width,
            height: screen.height,
            colorDepth: screen.colorDepth,
            pixelDepth: screen.pixelDepth
        },
        platform: navigator.platform,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        cookiesEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemory: (navigator as any).deviceMemory || null, // TypeScript workaround
        touchSupport: 'ontouchstart' in window
    };
};
