import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotifyProvider, Pager } from '@itrms/ui';
import { amText, enText, hostRenderer } from '../test-utils';
import { DataViewer } from './DataViewer';
import { FilterBuilder, describeCondition } from './FilterBuilder';
import type { Labeler } from './labels';
import type { ViewField, ViewSchema } from './types';

const f = (key: string, kind: ViewField['kind'], ops: ViewField['ops'], extra: Partial<ViewField> = {}): ViewField => ({
    key,
    label: extra.label ?? key,
    kind,
    person: false,
    builtin: false,
    ops,
    sortable: true,
    groupable: true,
    aggregatable: kind === 'number',
    options: [],
    ...extra
});

const schema: ViewSchema = {
    fields: [
        f('total', 'number', ['gte', 'lte', 'between'], { label: 'Total', currency: 'USD' }),
        f('kind', 'choice', ['eq', 'in'], {
            label: 'Kind',
            options: [
                { value: 'travel', label: 'Travel' },
                { value: 'meals', label: 'Meals' }
            ]
        }),
        f('urgent', 'boolean', ['eq'], { label: 'Urgent' })
    ],
    roles: {
        title: null,
        subtitle: null,
        stage: 'status',
        date: null,
        dateEnd: null,
        measures: [],
        people: [],
        files: [],
        rows: []
    },
    modes: ['table']
};
const labeler: Labeler = {
    field: (k) => schema.fields.find((x) => x.key === k),
    options: (k) => schema.fields.find((x) => x.key === k)?.options ?? [],
    lookup: () => new Map(),
    text: (k, v) =>
        k === 'total'
            ? `$${v}`
            : (schema.fields.find((x) => x.key === k)?.options.find((o) => o.value === v)?.label ?? String(v)),
    loading: false,
    t: enText
};
const wrap = hostRenderer({ language: 'en' });

describe('FilterBuilder', () => {
    it('builds conditions from the form fields and applies only complete ones', async () => {
        const user = userEvent.setup();
        const onApply = vi.fn();
        wrap(<FilterBuilder schema={schema} labeler={labeler} value={{ op: 'and', items: [] }} onApply={onApply} />);

        await user.click(screen.getByRole('button', { name: 'Filter' }));
        await user.click(screen.getByRole('button', { name: 'Add condition' }));
        await user.click(screen.getByRole('button', { name: 'Add condition' }));
        const row = (i: number) => {
            const el = document.querySelector<HTMLElement>(`[data-condition="${i}"]`);
            if (!el) throw new Error(`no condition row ${i}`);
            return el;
        };
        const [first, second] = [row(0), row(1)];

        // first: Total at least 300 (the first field and its first operator are preselected)
        await user.type(within(first).getByLabelText('Total Value'), '300');
        // second: Kind is Meals
        await user.click(within(second).getByRole('combobox', { name: 'Field' }));
        await user.click(await screen.findByRole('option', { name: 'Kind' }));
        await user.click(within(second).getByRole('combobox', { name: 'Kind value' }));
        await user.click(await screen.findByRole('option', { name: 'Meals' }));
        // a third, left empty, is not sent
        await user.click(screen.getByRole('button', { name: 'Add condition' }));
        await user.click(screen.getByRole('radio', { name: 'any' }));
        await user.click(screen.getByRole('button', { name: 'Apply' }));

        expect(onApply).toHaveBeenCalledWith({
            op: 'or',
            items: [
                { field: 'total', op: 'gte', value: 300 },
                { field: 'kind', op: 'eq', value: 'meals' }
            ]
        });
    });

    it('says when a condition is on a field that is not filterable (it reads every request)', async () => {
        const user = userEvent.setup();
        const slow: ViewSchema = {
            ...schema,
            fields: schema.fields.map((x) => ({ ...x, indexed: x.key !== 'total' }))
        };
        wrap(<FilterBuilder schema={slow} labeler={labeler} value={{ op: 'and', items: [] }} onApply={vi.fn()} />);
        await user.click(screen.getByRole('button', { name: 'Filter' }));
        await user.click(screen.getByRole('button', { name: 'Add condition' }));
        // the first field, Total, is preselected: not indexed
        expect(await screen.findByText(/“Total” is not filterable/)).toBeInTheDocument();
    });

    it('describes conditions in words, with labels instead of stored values', () => {
        expect(describeCondition({ field: 'total', op: 'between', value: [10, 20] }, schema, labeler)).toBe(
            'Total between $10 and $20'
        );
        expect(describeCondition({ field: 'kind', op: 'in', value: ['travel', 'meals'] }, schema, labeler)).toBe(
            'Kind is any of Travel, Meals'
        );
        expect(describeCondition({ field: 'urgent', op: 'eq', value: true }, schema, labeler)).toBe('Urgent is Yes');
    });
});

describe('in Amharic', () => {
    it('says the filter editor’s words in the screens’ language', async () => {
        const user = userEvent.setup();
        hostRenderer({ language: 'am' })(
            <FilterBuilder
                schema={schema}
                labeler={{ ...labeler, t: amText }}
                value={{ op: 'and', items: [] }}
                onApply={vi.fn()}
            />
        );
        await user.click(screen.getByRole('button', { name: amText('form-engine.viewer.filters.button') }));
        expect(screen.getByRole('button', { name: amText('form-engine.viewer.filters.add') })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: amText('form-engine.viewer.filters.apply') })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    });

    it('describes a condition in Amharic', () => {
        const am: Labeler = { ...labeler, t: amText };
        expect(describeCondition({ field: 'urgent', op: 'eq', value: true }, schema, am)).toBe(
            `Urgent ${amText('form-engine.viewer.op.eq')} ${amText('form-engine.core.print.yes')}`
        );
    });

    it('says an empty data viewer in Amharic', async () => {
        const wireSchema = {
            fields: [
                {
                    key: 'status',
                    label: 'Status',
                    kind: 'choice',
                    builtin: false,
                    ops: ['eq'],
                    sortable: true,
                    groupable: true,
                    aggregatable: false,
                    options: [],
                    currency: null,
                    type: null,
                    filterable: true,
                    indexed: true
                }
            ],
            roles: {
                title: null,
                subtitle: null,
                stage: 'status',
                date: null,
                dateEnd: null,
                measures: [],
                people: [],
                files: [],
                rows: []
            },
            modes: ['table']
        };
        const client = { get: vi.fn(), post: vi.fn() };
        client.get.mockImplementation((url: string) =>
            Promise.resolve({ data: url.endsWith('/view') ? wireSchema : { items: [] } })
        );
        client.post.mockResolvedValue({
            data: { items: [], total: 0, page: 1, pageSize: 20, aggregates: {}, groups: [], facets: {} }
        });
        const user = { id: 'u1', email: 'a@example.org', full_name: 'A', roles: [], tenant_id: 't1', permissions: [] };
        hostRenderer({ language: 'am', client, user })(
            <NotifyProvider>
                <DataViewer templateId="t1" onOpen={vi.fn()} />
            </NotifyProvider>
        );
        await waitFor(() => expect(screen.getByText(amText('form-engine.viewer.noRequests'))).toBeInTheDocument());
        expect(screen.getByRole('button', { name: amText('form-engine.viewer.filters.button') })).toBeInTheDocument();
        expect(screen.queryByText('No requests yet.')).not.toBeInTheDocument();
    });
});

describe('Pager', () => {
    it('says where the reader is and moves between pages', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<Pager page={1} pageSize={20} total={45} onChange={onChange} noun="requests" />);
        expect(screen.getByText('1–20 of 45 requests')).toBeInTheDocument();
        expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Last page' }));
        expect(onChange).toHaveBeenLastCalledWith({ page: 3, pageSize: 20 });

        rerender(<Pager page={3} pageSize={20} total={45} onChange={onChange} />);
        expect(screen.getByText('41–45 of 45')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    });
});
