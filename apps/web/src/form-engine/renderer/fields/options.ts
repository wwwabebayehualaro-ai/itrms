'use client';

import { useEffect, useMemo } from 'react';
import isEqual from 'lodash/isEqual.js';
import type { EngineField, FieldOption } from '../../core';
import { flattenOptions, toOptions, type SelectOption } from '../../Runtime/mapping';
import { useDataSource, useRuntimeApi } from '../runtimeScope';

export interface OptionsState {
    options: FieldOption[];
    isApi: boolean;
    loading: boolean;
    /** The options are final: static, or the bound data source has answered (selections may be checked against them). */
    settled: boolean;
    error: string | null;
    emptyMessage: string;
    retry: () => void;
}

/** Options of a choice field: the static list, or the rows of the data source it is bound to (`data.optionsBinding`). */
export function useOptions(field: EngineField): OptionsState {
    const binding = field.optionsBinding;
    const state = useDataSource(binding?.dataSourceId);
    const api = useRuntimeApi();
    const data = state?.data;
    const apiOptions = useMemo(() => {
        if (!binding || data === undefined) return [];
        const ds = api.getDataSource(binding.dataSourceId);
        return toOptions(data, { ...ds?.responseMapping?.options, ...binding.mapping }) as FieldOption[];
    }, [binding, data, api]);

    if (!binding)
        return {
            options: field.options,
            isApi: false,
            loading: false,
            settled: true,
            error: null,
            emptyMessage: 'No options available',
            retry: () => undefined
        };
    return {
        options: apiOptions,
        isApi: true,
        // no state yet = the runtime has not reported on this source: still loading, never "no options"
        loading: !state || state.isLoading || (state.status === 'loading' && state.data === undefined),
        settled: state?.status === 'success' && !state.isFetching,
        error: state?.error ?? null,
        emptyMessage: binding.emptyMessage || 'No options available',
        retry: () => void state?.refetch()
    };
}

export const sameValue = (a: unknown, b: unknown) => a === b || isEqual(a, b);
export const indexOfValue = (options: FieldOption[], value: unknown) =>
    options.findIndex((o) => sameValue(o.value, value));

/**
 * Cascading choices: when API options change, selections that are no longer offered are dropped (unless the binding says
 * `clearOnInvalid: false`). Only once the source has answered, and never on a disabled or read-only field (a saved record keeps
 * its values even if a person has since left the directory).
 */
export function useClearInvalid(
    field: EngineField,
    state: OptionsState,
    value: unknown,
    onChange: (v: unknown) => void,
    multiple: boolean,
    disabled: boolean
) {
    const values = useMemo(() => flattenOptions(state.options as SelectOption[]).map((o) => o.value), [state.options]);
    useEffect(() => {
        if (!state.isApi || !state.settled || state.error || disabled || field.optionsBinding?.clearOnInvalid === false)
            return;
        if (multiple) {
            const list = Array.isArray(value) ? value : [];
            const kept = list.filter((v) => values.some((o) => sameValue(o, v)));
            if (kept.length !== list.length) onChange(kept);
        } else if (value !== null && value !== undefined && value !== '' && !values.some((o) => sameValue(o, value))) {
            onChange(field.type === 'RadioButton' ? '' : null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the offered options change
    }, [state.isApi, state.settled, state.error, values]);
}
