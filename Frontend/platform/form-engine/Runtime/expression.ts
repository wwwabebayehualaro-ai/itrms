/**
 * Safe binding engine. Supports `{{path.to[0].value}}`, `{{path | default:"x"}}`.
 * There is NO code evaluation: expressions are parsed into a path plus a fixed
 * set of pipes, and prototype-polluting keys are rejected.
 */

import { evalFormula, formulaReferences } from './formula';

const BINDING = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE_BINDING = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
import { isForbiddenKey } from './path';

// `{{= formula }}` is evaluated by the formula engine; everything else is a plain path binding.
const isFormula = (expr: string) => expr.trimStart().startsWith('=');

export const UNRESOLVED = Symbol('unresolved');

export { parsePath, getByPath } from './path';
import { getByPath } from './path';

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
    const [pathPart, ...pipeParts] = expr.split('|');
    const parsed: ParsedExpression = { path: pathPart.trim(), hasDefault: false, pipes: [] };
    for (const p of pipeParts) {
        const m = p.trim().match(/^default\s*:\s*(.+)$/);
        if (m) {
            parsed.hasDefault = true;
            parsed.defaultValue = parseLiteral(m[1]);
        } else {
            parsed.pipes.push(p.trim());
        }
    }
    return parsed;
}

function applyPipes(value: any, pipes: string[]) {
    return pipes.reduce((v, pipe) => {
        switch (pipe) {
            case 'json':
                return JSON.stringify(v);
            case 'encode':
                return encodeURIComponent(v ?? '');
            case 'string':
                return v == null ? '' : String(v);
            case 'number':
                return v === '' || v == null ? undefined : Number(v);
            case 'boolean':
                return Boolean(v);
            case 'length':
                return v?.length ?? 0;
            default:
                return v;
        }
    }, value);
}

function evalExpression(expr: string, ctx: Record<string, any>): any {
    if (isFormula(expr)) return evalFormula(expr.trimStart().slice(1), ctx);
    const parsed = parseExpression(expr);
    const root = parsed.path.split(/[.[]/)[0];
    let value = ROOTS.has(root) || root in ctx ? getByPath(ctx, parsed.path) : undefined;
    if ((value === undefined || value === null || value === '') && parsed.hasDefault) value = parsed.defaultValue;
    return applyPipes(value, parsed.pipes);
}

/** Resolve one string. A string that is exactly one binding keeps the value's type. */
export function resolveString(input: string, ctx: Record<string, any>): any {
    const whole = input.match(WHOLE_BINDING);
    if (whole) return evalExpression(whole[1], ctx);
    return input.replace(BINDING, (_, expr) => {
        const v = evalExpression(expr, ctx);
        if (v === undefined || v === null) return '';
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
}

/** Deep-resolve strings inside any JSON-like value. */
export function resolveBindings<T = any>(value: T, ctx: Record<string, any>): any {
    if (typeof value === 'string') return value.includes('{{') ? resolveString(value, ctx) : value;
    if (Array.isArray(value)) return value.map((v) => resolveBindings(v, ctx));
    if (value && typeof value === 'object') {
        const out: Record<string, any> = {};
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
        for (const m of value.matchAll(BINDING)) {
            if (isFormula(m[1])) {
                formulaReferences(m[1].trimStart().slice(1)).forEach((r) => acc.add(r));
                continue;
            }
            const { path, hasDefault } = parseExpression(m[1]);
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
