import type { VisibilityCondition } from '../core/storedTypes';
import { evaluateAll } from '../core/conditions';
import { getByPath, parsePath } from './expression';
import { ErrorMapping, OptionMapping, ResponseMapping } from './types';

export interface SelectOption {
    label: string;
    value: any;
    disabled?: boolean;
    items?: SelectOption[];
    raw?: any;
}

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

function setByPath(target: Record<string, any>, path: string, value: unknown) {
    const keys = parsePath(path);
    if (keys.some((k) => FORBIDDEN.has(k))) return;
    let cur = target;
    keys.forEach((k, i) => {
        if (i === keys.length - 1) cur[k] = value;
        else cur = cur[k] && typeof cur[k] === 'object' ? cur[k] : (cur[k] = {});
    });
}

/** Evaluate a VisibilityCondition against a plain object using the shared evaluator. */
export function matchesCondition(condition: VisibilityCondition, subject: Record<string, any>, context?: Record<string, any>): boolean {
    return evaluateAll([condition], subject, context);
}

export function applyResponseMapping(response: unknown, mapping?: ResponseMapping): any {
    let data = mapping?.path ? getByPath(response, mapping.path) : response;
    for (const t of mapping?.transforms ?? []) {
        switch (t.op) {
            case 'pick':
                data = mapEach(data, (item) => {
                    const out: Record<string, any> = {};
                    t.paths.forEach((p) => setByPath(out, p, getByPath(item, p)));
                    return out;
                });
                break;
            case 'rename':
                data = mapEach(data, (item) => {
                    if (!item || typeof item !== 'object') return item;
                    const out = { ...item };
                    setByPath(out, t.to, getByPath(item, t.from));
                    if (t.from !== t.to && !t.from.includes('.')) delete out[t.from];
                    return out;
                });
                break;
            case 'default':
                data = mapEach(data, (item) => {
                    if (!item || typeof item !== 'object') return item;
                    const cur = getByPath(item, t.path);
                    if (cur !== undefined && cur !== null && cur !== '') return item;
                    const out = { ...item };
                    setByPath(out, t.path, t.value);
                    return out;
                });
                break;
            case 'filter':
                if (Array.isArray(data)) data = data.filter((item) => matchesCondition({ ...t.where, field: [t.path, t.where.field].filter(Boolean).join('.') }, item));
                break;
        }
    }
    return data;
}

function mapEach(data: any, fn: (item: any) => any) {
    return Array.isArray(data) ? data.map(fn) : fn(data);
}

export function toOptions(data: unknown, mapping: OptionMapping = {}): SelectOption[] {
    const list = mapping.itemsPath ? getByPath(data, mapping.itemsPath) : data;
    if (!Array.isArray(list)) return [];
    const convert = (item: any): SelectOption => {
        if (item === null || typeof item !== 'object') return { label: String(item), value: item, raw: item };
        const value = mapping.valuePath ? getByPath(item, mapping.valuePath) : (item.value ?? item.id);
        const label = mapping.labelPath ? getByPath(item, mapping.labelPath) : (item.label ?? item.name ?? value);
        const opt: SelectOption = { label: label == null ? '' : String(label), value, raw: item };
        if (mapping.disabledPath) opt.disabled = Boolean(getByPath(item, mapping.disabledPath));
        if (mapping.childrenPath) {
            const children = getByPath(item, mapping.childrenPath);
            if (Array.isArray(children)) opt.items = children.map(convert);
        }
        return opt;
    };
    return list.map(convert);
}

export function flattenOptions(options: SelectOption[]): SelectOption[] {
    return options.flatMap((o) => [o, ...(o.items ? flattenOptions(o.items) : [])]);
}

export function mapError(error: any, mapping?: ErrorMapping): string {
    const status = error?.response?.status;
    if (status !== undefined && mapping?.statusMessages?.[String(status)]) return mapping.statusMessages[String(status)];
    const fromBody = mapping?.messagePath ? getByPath(error?.response?.data, mapping.messagePath) : (error?.response?.data?.detail ?? error?.response?.data?.error ?? error?.response?.data?.message);
    if (typeof fromBody === 'string' && fromBody) return fromBody;
    if (mapping?.message) return mapping.message;
    if (error?.code === 'ECONNABORTED') return 'The request timed out';
    return error?.message || 'Request failed';
}

/** Build a { fieldId: value } patch from a mapped response. */
export function mapToForm(data: unknown, toForm?: Record<string, string>): Record<string, any> {
    const patch: Record<string, any> = {};
    Object.entries(toForm ?? {}).forEach(([fieldId, path]) => {
        const v = getByPath(data, path);
        if (v !== undefined) patch[fieldId] = v;
    });
    return patch;
}
