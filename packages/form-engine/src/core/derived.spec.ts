/**
 * Which computed fields follow the answers they read wherever the answers change (task 0.21e): read-only, and reading the
 * form, its rows and the root alone, never the user (it would take the changer's identity) nor data sources.
 */
import { describe, expect, it } from 'vitest';

import { answerDerived, readDocument } from './';

const computed = (id: string, expression: string, readOnly = true) => ({
    id,
    type: 'InputNumber',
    category: 'Input',
    label: id,
    props: {},
    data: { defaultProps: {}, computed: { expression, readOnly } }
});

describe('answerDerived', () => {
    it('is a read-only formula over the answers alone', () => {
        const { fields } = readDocument({
            fields: [
                computed('total', '{{= form.qty * 2 }}'),
                computed('grand', '{{= root.total + row.extra }}'),
                computed('filedBy', '{{ user.id }}'),
                computed('rate', '{{ data.rates.current }}'),
                computed('editable', '{{= form.qty * 2 }}', false),
                { id: 'qty', type: 'InputNumber', category: 'Input', label: 'qty', props: {} }
            ]
        });
        expect(Object.fromEntries(fields.map((f) => [f.id, answerDerived(f)]))).toEqual({
            total: true,
            grand: true,
            filedBy: false,
            rate: false,
            editable: false,
            qty: false
        });
    });
});
