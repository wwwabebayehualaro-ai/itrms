'use client';

/**
 * The runtime (data sources, `{{user.*}}`, route, variables) as a small external store, so a field re-renders only when the
 * part it reads changes. `RuntimeProvider` itself changes on every keystroke (its context includes the form values); fields
 * reading it directly would all re-render with each one.
 */
import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useRuntime, type DataSourceState } from '../Runtime/RuntimeProvider';
import type { DataSourceDefinition } from '../Runtime/types';

export interface RuntimeSnapshot {
    /** What conditions and bindings may read besides the form: `data`, `status`, `user`, `route`, `variables`. */
    scope: Record<string, unknown>;
    states: Record<string, DataSourceState>;
}

interface Api {
    run: (id: string, body?: unknown) => Promise<unknown>;
    refetch: (id?: string) => Promise<void>;
    reload: () => Promise<void>;
    getDataSource: (id: string) => DataSourceDefinition | undefined;
    hasDataSources: boolean;
}

export class RuntimeStore {
    private snapshot: RuntimeSnapshot = { scope: {}, states: {} };
    private listeners = new Set<() => void>();
    api: Api = { run: async () => undefined, refetch: async () => undefined, reload: async () => undefined, getDataSource: () => undefined, hasDataSources: false };

    get = () => this.snapshot;
    setApi(api: Api) {
        this.api = api;
    }
    subscribe = (fn: () => void) => {
        this.listeners.add(fn);
        return () => void this.listeners.delete(fn);
    };
    set(next: RuntimeSnapshot) {
        const prev = this.snapshot;
        const scope = sameEntries(prev.scope, next.scope) ? prev.scope : next.scope;
        const states = sameEntries(prev.states, next.states) ? prev.states : next.states;
        if (scope === prev.scope && states === prev.states) return;
        this.snapshot = { scope, states };
        this.listeners.forEach((fn) => fn());
    }
}

const sameEntries = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]) || ((k === 'variables' || k === 'status') && JSON.stringify(a[k]) === JSON.stringify(b[k])));
};

const StoreCtx = createContext<RuntimeStore | null>(null);
export const RuntimeStoreProvider = StoreCtx.Provider;

/** Rendered inside `RuntimeProvider`: copies what changed into the store. */
export function RuntimeBridge({ store }: { store: RuntimeStore }) {
    const rt = useRuntime();
    // the latest runtime for event handlers (submit, actions), without re-rendering anything
    const rtRef = useRef(rt);
    useLayoutEffect(() => {
        rtRef.current = rt;
        store.setApi({
            run: (id, body) => rtRef.current!.run(id, body),
            refetch: (id) => rtRef.current!.refetch(id),
            reload: () => rtRef.current!.reload(),
            getDataSource: (id) => rtRef.current?.getDataSource(id),
            hasDataSources: (rt?.config.dataSources.length ?? 0) > 0
        });
        const status = Object.fromEntries(Object.entries(rt?.states ?? {}).map(([id, s]) => [id, { state: s.status, error: s.error }]));
        store.set({ scope: { data: rt?.ctx.data, status, user: rt?.ctx.user, route: rt?.ctx.route, variables: rt?.ctx.variables }, states: rt?.states ?? {} });
    });
    return null;
}

const NO_STORE = new RuntimeStore();

/** Select from the runtime; re-renders only when the selected value changes. */
export function useRuntimeSelector<T>(select: (s: RuntimeSnapshot) => T): T {
    const store = useContext(StoreCtx) ?? NO_STORE;
    return useSyncExternalStore(
        store.subscribe,
        () => select(store.get()),
        () => select(store.get())
    );
}

export const useRuntimeScope = () => useRuntimeSelector((s) => s.scope);
export const useRuntimeApi = () => (useContext(StoreCtx) ?? NO_STORE).api;
export const useRuntimeStore = () => useContext(StoreCtx) ?? NO_STORE;
export function useDataSource(id: string | undefined): DataSourceState | undefined {
    return useRuntimeSelector((s) => (id ? s.states[id] : undefined));
}
