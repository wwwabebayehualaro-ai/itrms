/**
 * A filled-in form as plain, semantic HTML for the printed page, the case summary and the PDF worker (task 0.17c, used by
 * 0.23). What shows and how it is worded is decided by `printModel` in core; this only lays the nodes out. No hooks, no
 * host, no design system, no inline styles: it renders in Node with `renderToStaticMarkup` and passes a strict CSP. The
 * layout comes from `print.css` (`@itrms/form-engine/print.css`).
 */
import { createElement, type ReactNode } from 'react';
import { printModel, type PrintNode, type PrintOptions, type PrintWords } from '../core';

export interface PrintFormProps {
    /** a stored `form_config` (any version) */
    form: unknown;
    /** the answers keyed by field id */
    values: Record<string, unknown>;
    /** the language of the form's texts and of the dates */
    language: string;
    title?: string;
    options?: Omit<PrintOptions, 'language'>;
}

type ValueNode = Extract<PrintNode, { kind: 'value' }>;
type Level = 2 | 3 | 4 | 5 | 6;
const heading = (depth: number, props: { id?: string }, text: string) =>
    createElement(`h${Math.min(2 + depth, 6) as Level}`, props, text);

function Nodes({
    nodes,
    depth,
    words,
    scope
}: {
    nodes: PrintNode[];
    depth: number;
    words: PrintWords;
    scope: string;
}) {
    const out: ReactNode[] = [];
    let run: ValueNode[] = [];
    const flush = () => {
        if (!run.length) return;
        const items = run;
        run = [];
        out.push(
            <dl className="fe-print-grid" key={`${scope}-grid-${items[0]?.id}`}>
                {items.map((v) => (
                    <div className="fe-print-item" data-span={v.span} key={v.id}>
                        <dt>{v.label}</dt>
                        <dd className={v.multiline ? 'fe-print-multiline' : undefined}>{v.text}</dd>
                    </div>
                ))}
            </dl>
        );
    };
    for (const n of nodes) {
        if (n.kind === 'value') {
            run.push(n);
            continue;
        }
        flush();
        out.push(<Block node={n} depth={depth} words={words} scope={scope} key={`${scope}-${n.id}`} />);
    }
    flush();
    return <>{out}</>;
}

function Block({
    node,
    depth,
    words,
    scope
}: {
    node: Exclude<PrintNode, ValueNode>;
    depth: number;
    words: PrintWords;
    scope: string;
}) {
    if (node.kind === 'divider') return node.text ? <p className="fe-print-divider">{node.text}</p> : <hr />;
    const here = `${scope}-${node.id}`;
    const breakBefore = node.breakBefore ? { 'data-break-before': '' } : {};
    if (node.kind === 'group')
        return (
            <section aria-labelledby={`${here}-title`} {...breakBefore}>
                {heading(depth, { id: `${here}-title` }, node.title)}
                {node.subtitle && <p>{node.subtitle}</p>}
                <Nodes nodes={node.children} depth={depth + 1} words={words} scope={here} />
                {node.footer && <p>{node.footer}</p>}
            </section>
        );
    return (
        <section aria-labelledby={`${here}-title`} {...breakBefore}>
            {heading(depth, { id: `${here}-title` }, node.title)}
            {node.empty !== undefined && <p className="fe-print-empty">{node.empty}</p>}
            {node.layout === 'table' && node.rows.length > 0 && (
                <table>
                    <thead>
                        <tr>
                            <th scope="col">{words.rowNumber}</th>
                            {node.columns.map((c) => (
                                <th scope="col" key={c.id}>
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {node.rows.map((row, i) => (
                            <tr key={i}>
                                <td>{row.title}</td>
                                {row.cells.map((cell, j) => (
                                    <td key={node.columns[j]?.id ?? j}>{cell}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {node.layout === 'list' &&
                node.rows.map((row, i) => (
                    <div className="fe-print-row" key={i}>
                        {heading(depth + 1, {}, row.title)}
                        <Nodes nodes={row.children} depth={depth + 2} words={words} scope={`${here}-${i}`} />
                    </div>
                ))}
        </section>
    );
}

export function PrintForm({ form, values, language, title, options }: PrintFormProps) {
    const doc = printModel(form, values, { ...options, language });
    return (
        <article className="fe-print" lang={language}>
            {title && <h1>{title}</h1>}
            <Nodes nodes={doc.nodes} depth={0} words={doc.words} scope="p" />
        </article>
    );
}
