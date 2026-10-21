import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pager, TooltipProvider } from '@itrms/ui';
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
    loading: false
};
const wrap = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

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
