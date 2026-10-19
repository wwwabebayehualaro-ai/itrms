'use client';
import { useAuthStore } from './authStore';

export function useAuthUser() {
    return useAuthStore((s) => s.user);
}

/** Client-side hint for hiding UI; the backend remains the authority. */
export function useHasRole(...roles: string[]) {
    return useAuthStore(
        (s) => !!s.user && (s.user.roles.includes('admin') || roles.some((r) => s.user!.roles.includes(r)))
    );
}

/** Client-side hint for hiding UI the user may not use ("submission:delete"); the backend remains the authority. */
export function useCan(permission: string) {
    return useAuthStore((s) => !!s.user?.permissions?.includes(permission));
}
