'use client';

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { executeDataSource, isEnabled, prepareRequest, DataSourceError } from './dataSourceClient';
import { mapToForm } from '../../core/runtime/mapping';
import { resolveBindings } from '../../core/runtime/expression';
import {
    EMPTY_RUNTIME,
    type DataSourceDefinition,
    type RuntimeContext,
    type TemplateRuntimeConfig
} from '@itrms/schemas';

import { useFormsClient, useFormsLocation } from '../../host/FormsHost';
import { useEngineText } from '../../host/text';

export interface DataSourceState {
    data: unknown;
    status: 'idle' | 'loading' | 'success' | 'error';
    isLoading: boolean;
    isFetching: boolean;
    error: string | null;
    refetch: () => Promise<unknown>;
}

interface RuntimeValue {
    config: TemplateRuntimeConfig;
    ctx: RuntimeContext;
    states: Record<string, DataSourceState>;
    getDataSource: (id: string) => DataSourceDefinition | undefined;
    refetch: (id?: string) => Promise<void>;
    /** Run a (mutation) data source with the current context. */
    run: (id: string, bodyOverride?: unknown) => Promise<unknown>;
    /** Re-apply `loadIntoForm` data and refetch all sources (used by form reset / refresh). */
    reload: () => Promise<void>;
}

const RuntimeCtx = createContext<RuntimeValue | null>(null);
const IDLE: DataSourceState = {
    data: undefined,
    status: 'idle',
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: () => Promise.resolve(undefined)
};

interface ProviderProps {
    config?: TemplateRuntimeConfig;
    formValues: Record<string, unknown>;
    /** Authenticated user info supplied by the host app (never read from the template). */
    user?: Record<string, unknown>;
    /** Applies `loadIntoForm` results. */
    onPatchForm?: (patch: Record<string, unknown>) => void;
    /** Mutations never auto-run; only GET sources are queried. */
    children: React.ReactNode;
}

export function RuntimeProvider({ config = EMPTY_RUNTIME, formValues, user, onPatchForm, children }: ProviderProps) {
    const queryClient = useQueryClient();
    const client = useFormsClient();
    const { language } = useEngineText();
    const { params, search } = useFormsLocation();
    const [data, setData] = useState<Record<string, unknown>>({});

    const route = useMemo(
        () => ({ ...Object.fromEntries(search?.entries() ?? []), ...(params ?? {}) }),
        [params, search]
    );

    const baseCtx = useMemo(
        () => ({ form: formValues, data, user: user ?? {}, route }),
        [formValues, data, user, route]
    );

    // Variables may reference form/data/user/route and earlier variables.
    const ctx: RuntimeContext = useMemo(() => {
        const variables: Record<string, unknown> = {};
        (config.variables ?? []).forEach((v) => {
            variables[v.name] = resolveBindings(v.value, { ...baseCtx, variables });
        });
        return { ...baseCtx, variables };
    }, [baseCtx, config.variables]);

    const sources = useMemo(() => config.dataSources.filter((d) => d.request.method === 'GET'), [config.dataSources]);

    const results = useQueries({
        queries: sources.map((ds) => {
            const enabled = isEnabled(ds, ctx);
            let key: unknown[] = ['runtime-ds', ds.id];
            if (enabled) {
                try {
                    key = ['runtime-ds', ...prepareRequest(ds, ctx).key];
                } catch {
                    /* surfaced when the query runs */
                }
            }
            return {
                queryKey: key,
                enabled,
                queryFn: ({ signal }: { signal: AbortSignal }) =>
                    executeDataSource(client, ds, ctx, { signal, language }),
                staleTime: ds.cache?.staleTimeMs ?? 30_000,
                gcTime: ds.cache?.gcTimeMs ?? 5 * 60_000,
                refetchOnMount: ds.refetch?.onMount === false ? (false as const) : (true as const),
                refetchOnWindowFocus: ds.refetch?.onWindowFocus ?? false,
                refetchInterval: ds.refetch?.intervalMs ? ds.refetch.intervalMs : (false as const),
                retry: false as const // retry policy is owned by the data source definition
            };
        })
    });

    // Publish results into `data` so other sources/fields can bind to {{data.<id>}}. The queries above were built from the previous
    // `data` (a source may depend on another's answer), so this is state adjusted during render when the answers change.
    const signature = results
        .map((r, i) => `${sources[i]?.id}:${r.dataUpdatedAt}:${r.status}:${r.fetchStatus}`)
        .join('|');
    const [seen, setSeen] = useState('');
    if (seen !== signature) {
        setSeen(signature);
        const next: Record<string, unknown> = {};
        results.forEach((r, i) => {
            const ds = sources[i];
            if (ds && r.data !== undefined) next[ds.id] = r.data;
        });
        if (JSON.stringify(next) !== JSON.stringify(data)) setData(next);
    }

    // One-time load of mapped data into the form.
    const loaded = useRef(new Set<string>());
    useEffect(() => {
        results.forEach((r, i) => {
            const ds = sources[i];
            if (ds?.loadIntoForm && r.status === 'success' && !loaded.current.has(ds.id)) {
                loaded.current.add(ds.id);
                const patch = mapToForm(r.data, ds.responseMapping?.toForm);
                if (Object.keys(patch).length) onPatchForm?.(patch);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    const states = useMemo(() => {
        const out: Record<string, DataSourceState> = {};
        results.forEach((r, i) => {
            const ds = sources[i];
            if (!ds) return;
            out[ds.id] = {
                data: r.data,
                status: !isEnabled(ds, ctx)
                    ? 'idle'
                    : r.status === 'pending'
                      ? 'loading'
                      : r.status === 'error'
                        ? 'error'
                        : 'success',
                isLoading: r.isLoading,
                isFetching: r.isFetching,
                error: r.error ? (r.error instanceof DataSourceError ? r.error.message : r.error.message) : null,
                refetch: () => r.refetch()
            };
        });
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature, ctx]);

    const refetch = useCallback(
        async (id?: string) => {
            const targets = id ? sources.filter((s) => s.id === id) : sources;
            await Promise.all(
                targets.map((s) =>
                    queryClient.invalidateQueries({
                        queryKey: ['runtime-ds'],
                        predicate: (q) => q.queryKey[1] === s.id
                    })
                )
            );
        },
        [queryClient, sources]
    );

    const reload = useCallback(async () => {
        loaded.current.clear();
        await refetch();
    }, [refetch]);

    // `run` keeps one identity (consumers hold it) and always uses the latest context
    const ctxRef = useRef(ctx);
    useLayoutEffect(() => {
        ctxRef.current = ctx;
    });
    const run = useCallback(
        async (id: string, bodyOverride?: unknown) => {
            const ds = config.dataSources.find((d) => d.id === id);
            if (!ds) throw new DataSourceError(`Unknown data source "${id}"`);
            return executeDataSource(client, ds, ctxRef.current, { bodyOverride, language });
        },
        [client, config.dataSources, language]
    );

    const value = useMemo<RuntimeValue>(
        () => ({
            config,
            ctx,
            states,
            getDataSource: (id) => config.dataSources.find((d) => d.id === id),
            refetch,
            run,
            reload
        }),
        [config, ctx, states, refetch, run, reload]
    );

    return <RuntimeCtx.Provider value={value}>{children}</RuntimeCtx.Provider>;
}

/** Returns null outside a provider so fields still work with static options (e.g. builder canvas). */
export const useRuntime = () => useContext(RuntimeCtx);

export function useDataSourceState(id?: string): DataSourceState {
    const rt = useRuntime();
    return (id && rt?.states[id]) || IDLE;
}
