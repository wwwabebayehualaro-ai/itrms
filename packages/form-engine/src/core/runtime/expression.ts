/**
 * Safe binding engine. Supports `{{path.to[0].value}}`, `{{path | default:"x"}}`.
 * There is NO code evaluation: expressions are parsed into a path plus a fixed
 * set of pipes, and prototype-polluting keys are rejected.
 */

import { evalFormula, formulaReferences } from './formula';
import { getByPath, isForbiddenKey, text } from './path';

const BINDING = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE_BINDING = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;

// `{{= formula }}` is evaluated by the formula engine; everything else is a plain path binding.
const isFormula = (expr: string) => expr.trimStart().startsWith('=');

export const UNRESOLVED = Symbol('unresolved');

export { parsePath, getByPath } from './path';

/** What bindings read: `form`, `data`, `user`, `route`, `variables`, `row`, `root` and anything else the caller puts in. */
export type BindingScope = Record<string, unknown>;

const ROOTS = new Set(['form', 'data', 'user', 'route', 'variables', 'row', 'root']);

interface ParsedExpression {
    path: string;
    hasDefault: boolean;
    defaultValue?: unknown;
    pipes: string[];
}

function parseLiteral(raw: string): unknown {
    const t = raw.trim();
    if (/^".*"$|^'.*'$/.test(t)) return t.slice(1, -1);
    if (t === 'null') return null;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
    return t;
}

function parseExpression(expr: string): ParsedExpression {
    const [pathPart = '', ...pipeParts] = expr.split('|');
    const parsed: ParsedExpression = { path: pathPart.trim(), hasDefault: false, pipes: [] };
    for (const p of pipeParts) {
        const m = /^default\s*:\s*(.+)$/.exec(p.trim());
        if (m) {
            parsed.hasDefault = true;
            parsed.defaultValue = parseLiteral(m[1] ?? '');
        } else {
            parsed.pipes.push(p.trim());
        }
    }
    return parsed;
}

function applyPipes(value: unknown, pipes: string[]) {
    return pipes.reduce<unknown>((v, pipe) => {
        switch (pipe) {
            case 'json':
                return JSON.stringify(v);
            case 'encode':
                return encodeURIComponent(text(v));
            case 'string':
                return text(v);
            case 'number':
                return v === '' || v == null ? undefined : Number(v);
            case 'boolean':
                return Boolean(v);
            case 'length':
                return v === null || v === undefined ? 0 : ((v as { length?: unknown }).length ?? 0);
            default:
                return v;
        }
    }, value);
}

function evalExpression(expr: string, ctx: BindingScope): unknown {
    if (isFormula(expr)) return evalFormula(expr.trimStart().slice(1), ctx);
    const parsed = parseExpression(expr);
    const root = parsed.path.split(/[.[]/)[0] ?? '';
    let value = ROOTS.has(root) || root in ctx ? getByPath(ctx, parsed.path) : undefined;
    if ((value === undefined || value === null || value === '') && parsed.hasDefault) value = parsed.defaultValue;
    return applyPipes(value, parsed.pipes);
}

/** Resolve one string. A string that is exactly one binding keeps the value's type. */
export function resolveString(input: string, ctx: BindingScope): unknown {
    const whole = WHOLE_BINDING.exec(input);
    if (whole) return evalExpression(whole[1] ?? '', ctx);
    return input.replace(BINDING, (_, expr: string) => {
        const v = evalExpression(expr, ctx);
        if (v === undefined || v === null) return '';
        return typeof v === 'object' ? JSON.stringify(v) : text(v);
    });
}

/** Deep-resolve strings inside any JSON-like value. */
export function resolveBindings(value: unknown, ctx: BindingScope): unknown {
    if (typeof value === 'string') return value.includes('{{') ? resolveString(value, ctx) : value;
    if (Array.isArray(value)) return value.map((v) => resolveBindings(v, ctx));
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            if (isForbiddenKey(k)) continue;
            out[k] = resolveBindings(v, ctx);
        }
        return out;
    }
    return value;
}

/** All `root.path` references used inside a JSON-like value (for dependency tracking). */
export function extractReferences(value: unknown, acc: Set<string> = new Set()): Set<string> {
    if (typeof value === 'string') {
        for (const [, expr = ''] of value.matchAll(BINDING)) {
            if (isFormula(expr)) {
                formulaReferences(expr.trimStart().slice(1)).forEach((r) => acc.add(r));
                continue;
            }
            const { path, hasDefault } = parseExpression(expr);
            if (!hasDefault) acc.add(path);
        }
    } else if (Array.isArray(value)) {
        value.forEach((v) => extractReferences(v, acc));
    } else if (value && typeof value === 'object') {
        Object.values(value).forEach((v) => extractReferences(v, acc));
    }
    return acc;
}

export function isEmptyValue(v: unknown) {
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** The roots (`form`, `data`, `user` …) a string's bindings read, defaulted ones included. */
export function bindingRoots(input: string): Set<string> {
    const roots = new Set<string>();
    for (const [, expr = ''] of input.matchAll(BINDING)) {
        const paths = isFormula(expr) ? formulaReferences(expr.trimStart().slice(1)) : [parseExpression(expr).path];
        for (const p of paths) roots.add(p.split(/[.[]/)[0] ?? '');
    }
    return roots;
}
