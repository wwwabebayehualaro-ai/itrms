/**
 * The logic inspector under the builder's preview (task 1.13c): it names the rule that hides a field, with the value each
 * condition looked at, and says why a field is required. It follows the values entered in the preview.
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { hostRenderer } from '../test-utils';
import { LogicInspector } from './LogicInspector';
import type { StoredDocument } from './document';

const render = hostRenderer({
    language: 'en',
    client: { get: vi.fn(), post: vi.fn(), request: vi.fn() },
    user: { id: 'u1', email: 'maker@example.org', full_name: 'Maker', roles: [], tenant_id: 't1', permissions: [] }
});

const stored = {
    schemaVersion: 2,
    fields: [
        {
            id: 'company',
            type: 'Checkbox',
            label: 'A company',
            category: 'Input',
            props: {},
            data: { defaultProps: {} },
            behavior: { validation: { supported: true } },
            layout: { options: { isContainer: false } }
        },
        {
            id: 'tin',
            type: 'InputText',
            label: 'TIN',
            category: 'Input',
            props: {},
            data: { defaultProps: {} },
            behavior: {
                validation: { supported: true },
                visibilityConditions: [{ field: 'company', operator: 'eq', value: true }]
            },
            layout: { options: { isContainer: false } }
        }
    ],
    runtime: { dataSources: [], actions: [] }
} as unknown as StoredDocument;

describe('the logic inspector', () => {
    it('names the condition that hides a field, with the value it looked at', () => {
        render(<LogicInspector stored={stored} values={{ company: false }} language="en" />);
        const panel = screen.getByText('Logic inspector').closest('[data-logic-inspector]') as HTMLElement;
        const explained = within(panel);
        expect(panel.querySelector('[data-inspector-state="visible"]')).toHaveAttribute('data-value', 'no');
        expect(explained.getByText('The rule of “TIN”')).toBeInTheDocument();
        const condition = panel.querySelector('[data-inspector-condition="company"]');
        expect(condition).toHaveAttribute('data-holds', 'false');
        expect(condition).toHaveTextContent('A company');
        expect(condition).toHaveTextContent('(the value is false)');
    });

    it('follows the values entered: the field is shown once its condition holds', () => {
        render(<LogicInspector stored={stored} values={{ company: true }} language="en" />);
        const panel = screen.getByText('Logic inspector').closest('[data-logic-inspector]') as HTMLElement;
        expect(panel.querySelector('[data-inspector-state="visible"]')).toHaveAttribute('data-value', 'yes');
        expect(panel.querySelector('[data-inspector-condition="company"]')).toHaveAttribute('data-holds', 'true');
    });

    it('says so when no field has a rule', () => {
        const plain = { ...stored, fields: [stored.fields[0]] } as unknown as StoredDocument;
        render(<LogicInspector stored={plain} values={{}} language="en" />);
        expect(
            screen.getByText('No field of this form has a rule that shows, hides, locks or requires it.')
        ).toBeInTheDocument();
    });
});
