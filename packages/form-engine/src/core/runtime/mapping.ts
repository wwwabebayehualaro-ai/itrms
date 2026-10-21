import type { ErrorMapping, OptionMapping, ResponseMapping, VisibilityCondition } from '@itrms/schemas';

import { evaluateAll, type Scope } from '../conditions';
import { getByPath, parsePath } from './expression';
import { str } from './path';

export interface SelectOption {
    label: string;
    value: unknown;
    disabled?: boolean;
    items?: SelectOption[];
    raw?: unknown;
}

type Row = Record<string, unknown>;

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

const isObject = (v: unknown): v is Row => !!v && typeof v === 'object';

function setByPath(target: Row, path: string, value: unknown) {
    const keys = parsePath(path);
    if (keys.some((k) => FORBIDDEN.has(k))) return;
    let cur = target;
    keys.forEach((k, i) => {
        if (i === keys.length - 1) cur[k] = value;
        else {
            const next = cur[k];
            cur = isObject(next) ? next : (cur[k] = {});
        }
    });
}

/** Evaluate a VisibilityCondition against a plain object using the shared evaluator. */
export function matchesCondition(condition: VisibilityCondition, subject: Row, context?: Scope): boolean {
    return evaluateAll([condition], subject, context);
}

export function applyResponseMapping(response: unknown, mapping?: ResponseMapping): unknown {
    let data = mapping?.path ? getByPath(response, mapping.path) : response;
    for (const t of mapping?.transforms ?? []) {
        switch (t.op) {
            case 'pick':
                data = mapEach(data, (item) => {
                    const out: Row = {};
                    t.paths.forEach((p) => setByPath(out, p, getByPath(item, p)));
                    return out;
                });
                break;
            case 'rename':
                data = mapEach(data, (item) => {
                    if (!isObject(item)) return item;
                    const out = { ...item };
                    setByPath(out, t.to, getByPath(item, t.from));
                    if (t.from !== t.to && !t.from.includes('.')) delete out[t.from];
                    return out;
                });
                break;
            case 'default':
                data = mapEach(data, (item) => {
                    if (!isObject(item)) return item;
                    const cur = getByPath(item, t.path);
                    if (cur !== undefined && cur !== null && cur !== '') return item;
                    const out = { ...item };
                    setByPath(out, t.path, t.value);
                    return out;
                });
                break;
            case 'filter':
                if (Array.isArray(data))
                    data = data.filter((item: unknown) =>
                        matchesCondition(
                            { ...t.where, field: [t.path, t.where.field].filter(Boolean).join('.') },
                            item as Row
                        )
                    );
                break;
        }
    }
    return data;
}

function mapEach(data: unknown, fn: (item: unknown) => unknown) {
    return Array.isArray(data) ? data.map(fn) : fn(data);
}

export function toOptions(data: unknown, mapping: OptionMapping = {}): SelectOption[] {
    const list = mapping.itemsPath ? getByPath(data, mapping.itemsPath) : data;
    if (!Array.isArray(list)) return [];
    const convert = (item: unknown): SelectOption => {
        if (!isObject(item)) return { label: str(item), value: item, raw: item };
        const value = mapping.valuePath ? getByPath(item, mapping.valuePath) : (item.value ?? item.id);
        const label = mapping.labelPath ? getByPath(item, mapping.labelPath) : (item.label ?? item.name ?? value);
        const opt: SelectOption = { label: label == null ? '' : str(label), value, raw: item };
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

/** The parts of a failed call a message is made from (the app client's error, or anything else thrown). */
interface FailedCall {
    response?: { status?: number; data?: unknown };
    code?: unknown;
    message?: unknown;
}

export function mapError(error: unknown, mapping?: ErrorMapping): string {
    const e: FailedCall = isObject(error) ? error : {};
    const status = e.response?.status;
    const byStatus = status !== undefined ? mapping?.statusMessages?.[String(status)] : undefined;
    if (byStatus) return byStatus;
    const data = e.response?.data;
    const body = isObject(data) ? data : undefined;
    const fromBody = mapping?.messagePath
        ? getByPath(data, mapping.messagePath)
        : (body?.detail ?? body?.error ?? body?.message);
    if (typeof fromBody === 'string' && fromBody) return fromBody;
    if (mapping?.message) return mapping.message;
    if (e.code === 'ECONNABORTED') return 'The request timed out';
    return typeof e.message === 'string' && e.message ? e.message : 'Request failed';
}

/** Build a { fieldId: value } patch from a mapped response. */
export function mapToForm(data: unknown, toForm?: Record<string, string>): Row {
    const patch: Row = {};
    Object.entries(toForm ?? {}).forEach(([fieldId, path]) => {
        const v = getByPath(data, path);
        if (v !== undefined) patch[fieldId] = v;
    });
    return patch;
}
