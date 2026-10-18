/**
 * Safe formula language for computed values: `{{= row.qty * row.price }}`, `{{= round(sum(root.lines, 'total'), 2) }}`.
 *
 * A hand-written tokenizer + precedence-climbing parser produces an AST that is evaluated against the binding
 * scope. There is no `eval`/`Function`, no property access outside the scope's data, and evaluation is bounded
 * (expression length, AST depth, function set, no loops), so template authors cannot run code.
 *
 * Grammar (lowest → highest precedence):  ?:  ||  &&  == !=  < <= > >=  + -  * / %  unary(- !)  call/ref/literal
 * Arithmetic treats empty inputs like a spreadsheet: null / undefined / '' / non-numeric → 0.
 */
import { getByPath } from './path';

const MAX_LENGTH = 500;
const MAX_DEPTH = 40;

type Token = { t: 'num' | 'str' | 'id' | 'op' | 'eof'; v: string };
type Node =
    | { k: 'lit'; v: number | string | boolean | null }
    | { k: 'ref'; path: string }
    | { k: 'un'; op: '-' | '!'; a: Node }
    | { k: 'bin'; op: string; a: Node; b: Node }
    | { k: 'cond'; c: Node; a: Node; b: Node }
    | { k: 'call'; fn: string; args: Node[] };

export class FormulaError extends Error {}

function tokenize(src: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        if (/[0-9.]/.test(c)) {
            const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
            if (!m) throw new FormulaError(`Bad number at ${i}`);
            out.push({ t: 'num', v: m[0] }); i += m[0].length; continue;
        }
        if (c === "'" || c === '"') {
            let j = i + 1, s = '';
            while (j < src.length && src[j] !== c) { s += src[j] === '\\' ? src[++j] ?? '' : src[j]; j++; }
            if (src[j] !== c) throw new FormulaError('Unterminated string');
            out.push({ t: 'str', v: s }); i = j + 1; continue;
        }
        if (/[A-Za-z_]/.test(c)) {
            const m = /^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_-]*)|(?:\[\d+\]))*/.exec(src.slice(i))!;
            out.push({ t: 'id', v: m[0] }); i += m[0].length; continue;
        }
        const two = src.slice(i, i + 2);
        if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
        if ('+-*/%<>!?:(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
        throw new FormulaError(`Unexpected "${c}"`);
    }
    out.push({ t: 'eof', v: '' });
    return out;
}

const BIN_LEVELS: string[][] = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

function parse(src: string): Node {
    if (src.length > MAX_LENGTH) throw new FormulaError('Formula too long');
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const eat = (v?: string) => {
        const tk = toks[p];
        if (v !== undefined && tk.v !== v) throw new FormulaError(`Expected "${v}"`);
        p++;
        return tk;
    };
    const isOp = (v: string) => peek().t === 'op' && peek().v === v;

    const expr = (depth: number): Node => {
        if (depth > MAX_DEPTH) throw new FormulaError('Formula too deeply nested');
        const c = level(0, depth + 1);
        if (isOp('?')) {
            eat('?');
            const a = expr(depth + 1);
            eat(':');
            const b = expr(depth + 1);
            return { k: 'cond', c, a, b };
        }
        return c;
    };
    const level = (i: number, depth: number): Node => {
        if (i >= BIN_LEVELS.length) return unary(depth);
        let left = level(i + 1, depth);
        while (peek().t === 'op' && BIN_LEVELS[i].includes(peek().v)) {
            const op = eat().v;
            left = { k: 'bin', op, a: left, b: level(i + 1, depth) };
        }
        return left;
    };
    const unary = (depth: number): Node => {
        if (depth > MAX_DEPTH) throw new FormulaError('Formula too deeply nested');
        if (isOp('-') || isOp('!')) return { k: 'un', op: eat().v as '-' | '!', a: unary(depth + 1) };
        return primary(depth);
    };
    const primary = (depth: number): Node => {
        const tk = eat();
        if (tk.t === 'num') return { k: 'lit', v: Number(tk.v) };
        if (tk.t === 'str') return { k: 'lit', v: tk.v };
        if (tk.t === 'op' && tk.v === '(') {
            const e = expr(depth + 1);
            eat(')');
            return e;
        }
        if (tk.t === 'id') {
            if (tk.v === 'true' || tk.v === 'false') return { k: 'lit', v: tk.v === 'true' };
            if (tk.v === 'null') return { k: 'lit', v: null };
            if (isOp('(')) {
                eat('(');
                const args: Node[] = [];
                if (!isOp(')')) {
                    do args.push(expr(depth + 1));
                    while (isOp(',') && eat(','));
                }
                eat(')');
                return { k: 'call', fn: tk.v, args };
            }
            return { k: 'ref', path: tk.v };
        }
        throw new FormulaError(`Unexpected "${tk.v || 'end'}"`);
    };

    const ast = expr(0);
    if (peek().t !== 'eof') throw new FormulaError(`Unexpected "${peek().v}"`);
    return ast;
}

const cache = new Map<string, Node>();
const compile = (src: string) => {
    let ast = cache.get(src);
    if (!ast) {
        ast = parse(src);
        if (cache.size > 500) cache.clear();
        cache.set(src, ast);
    }
    return ast;
};

const num = (v: unknown): number => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
};
const truthy = (v: unknown) => !(v === null || v === undefined || v === '' || v === 0 || v === false);
const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

/** sum(list) / sum(list, 'field') - numbers in an array, or a numeric field of each object in it. */
const pluck = (list: unknown, field?: unknown): number[] =>
    (Array.isArray(list) ? list : []).map((row) => (field === undefined ? num(row) : num(getByPath(row, String(field)))));

const FUNCTIONS: Record<string, (args: unknown[]) => unknown> = {
    sum: ([l, f]) => pluck(l, f).reduce((a, b) => a + b, 0),
    avg: ([l, f]) => { const v = pluck(l, f); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; },
    count: ([l]) => (Array.isArray(l) ? l.length : 0),
    min: (a) => (a.length === 1 && Array.isArray(a[0]) ? Math.min(...pluck(a[0])) : Math.min(...a.map(num))),
    max: (a) => (a.length === 1 && Array.isArray(a[0]) ? Math.max(...pluck(a[0])) : Math.max(...a.map(num))),
    round: ([n, d]) => { const f = 10 ** Math.max(0, Math.min(10, num(d))); return Math.round((num(n) + Number.EPSILON) * f) / f; },
    floor: ([n]) => Math.floor(num(n)),
    ceil: ([n]) => Math.ceil(num(n)),
    abs: ([n]) => Math.abs(num(n)),
    if: ([c, a, b]) => (truthy(c) ? a : b),
    coalesce: (a) => a.find((v) => !isEmpty(v)) ?? null,
    concat: (a) => a.map((v) => (v === null || v === undefined ? '' : String(v))).join(''),
    upper: ([s]) => String(s ?? '').toUpperCase(),
    lower: ([s]) => String(s ?? '').toLowerCase(),
    isEmpty: ([v]) => isEmpty(v) || (Array.isArray(v) && v.length === 0)
};

function run(n: Node, scope: Record<string, any>): unknown {
    switch (n.k) {
        case 'lit': return n.v;
        case 'ref': return getByPath(scope, n.path);
        case 'un': return n.op === '-' ? -num(run(n.a, scope)) : !truthy(run(n.a, scope));
        case 'cond': return truthy(run(n.c, scope)) ? run(n.a, scope) : run(n.b, scope);
        case 'call': {
            const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, n.fn) ? FUNCTIONS[n.fn] : undefined;
            if (!fn) throw new FormulaError(`Unknown function "${n.fn}"`);
            return fn(n.args.map((a) => run(a, scope)));
        }
        case 'bin': {
            if (n.op === '&&') { const l = run(n.a, scope); return truthy(l) ? run(n.b, scope) : l; }
            if (n.op === '||') { const l = run(n.a, scope); return truthy(l) ? l : run(n.b, scope); }
            const l = run(n.a, scope), r = run(n.b, scope);
            switch (n.op) {
                case '+': return typeof l === 'string' || typeof r === 'string' ? `${l ?? ''}${r ?? ''}` : num(l) + num(r);
                case '-': return num(l) - num(r);
                case '*': return num(l) * num(r);
                case '/': return num(r) === 0 ? null : num(l) / num(r);
                case '%': return num(r) === 0 ? null : num(l) % num(r);
                case '==': return isEmpty(l) && isEmpty(r) ? true : l === r || (typeof l !== typeof r && String(l) === String(r));
                case '!=': return !(isEmpty(l) && isEmpty(r) ? true : l === r || (typeof l !== typeof r && String(l) === String(r)));
                case '<': return num(l) < num(r);
                case '<=': return num(l) <= num(r);
                case '>': return num(l) > num(r);
                case '>=': return num(l) >= num(r);
            }
        }
    }
    return null;
}

/** Evaluate a formula. Errors never throw to the renderer: they yield `undefined` (the field stays as it was). */
export function evalFormula(src: string, scope: Record<string, any>): unknown {
    try {
        const out = run(compile(src), scope);
        return typeof out === 'number' && !Number.isFinite(out) ? null : out;
    } catch {
        return undefined;
    }
}

/** Syntax check for the builder: returns an error message or null. */
export function checkFormula(src: string): string | null {
    try {
        compile(src);
        return null;
    } catch (e) {
        return e instanceof FormulaError ? e.message : 'Invalid formula';
    }
}

/** Data references used by a formula (for dependency tracking); function names are not references. */
export function formulaReferences(src: string): string[] {
    const refs = new Set<string>();
    const walk = (n: Node) => {
        if (n.k === 'ref') refs.add(n.path);
        else if (n.k === 'un') walk(n.a);
        else if (n.k === 'bin') { walk(n.a); walk(n.b); }
        else if (n.k === 'cond') { walk(n.c); walk(n.a); walk(n.b); }
        else if (n.k === 'call') n.args.forEach(walk);
    };
    try { walk(compile(src)); } catch { /* invalid formulas have no references */ }
    return [...refs];
}
