import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { FormField, FormTemplate } from '@itrms/schemas';
import type * as UI from '@itrms/ui';

import { FormDesigner, PublishReview, useBuilderActions } from './';
import type { PublishCheck } from '../api/wire';
import type { FormsClient, FormsRequestOptions, FormsResponse } from '../host/client';
import { amText, hostRenderer } from '../test-utils';

const client = vi.hoisted(() => ({
    get: vi.fn<(url: string, options?: FormsRequestOptions) => Promise<FormsResponse>>(),
    post: vi.fn<(url: string, data?: unknown, options?: FormsRequestOptions) => Promise<FormsResponse>>()
}));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({
    ...(await original<typeof UI>()),
    useNotify: () => notify
}));
const fakeClient = client as Partial<FormsClient>;
const answer = (data: unknown): FormsResponse => ({ data, status: 200, headers: {} });

const field = (id: string, type: string, label: string): FormField => ({
    id,
    type,
    label,
    category: 'Input',
    props: {},
    data: { defaultProps: {} },
    behavior: { validation: { supported: true } },
    layout: { options: { isContainer: false } }
});
const fields = [field('fullName', 'InputText', 'Full name'), field('officeType', 'InputText', 'Office type')];
const saved: FormTemplate = {
    id: 'tpl-1',
    name: 'Trip',
    slug: 'trip',
    row_version: 3,
    status: 'published',
    published_version_id: 'v1',
    form_config: { fields, runtime: { dataSources: [] } }
};
const render = hostRenderer({
    client: fakeClient,
    language: 'am',
    user: { id: 'u1', roles: ['editor'], permissions: ['form:update', 'form:publish'] }
});

/** The published version is the saved one: the forms API's form and its published version. */
function publishedAnswers() {
    client.get.mockImplementation((url) => {
        if (url.endsWith('/versions/published'))
            return Promise.resolve(
                answer({
                    id: 'v1',
                    formId: 'tpl-1',
                    number: 1,
                    document: { fields, runtime: { dataSources: [] } },
                    createdAt: '2026-10-01T08:00:00.000Z'
                })
            );
        return Promise.resolve(
            answer({
                id: 'tpl-1',
                version: 3,
                key: 'trip',
                name: { am: 'Trip', en: 'Trip' },
                category: null,
                active: true,
                status: 'published',
                ownerUnit: { id: 'u-1', code: 'Z', name: { en: 'Zone' } },
                publishedVersion: { id: 'v1', number: 1, publishedAt: '2026-10-01T09:00:00.000Z' },
                updatedAt: '2026-10-01T09:00:00.000Z',
                document: { fields, runtime: { dataSources: [] } }
            })
        );
    });
}

function open() {
    const { result } = renderHook(() => useBuilderActions());
    act(() => {
        result.current.setTemplate(saved);
        result.current.setFields(fields);
        result.current.setRuntime({ dataSources: [] });
    });
    return render(<FormDesigner />);
}

describe('published keys in the builder', () => {
    it('locks the key of a published field and removes it as a flag, with Restore', async () => {
        const user = userEvent.setup();
        publishedAnswers();
        open();
        const canvas = screen.getByRole('main');
        await user.click(canvas.querySelector('[data-design-field="officeType"]') as HTMLElement);
        const inspector = screen.getByRole('complementary', {
            name: amText('form-engine.designer.toolbar.fieldSettings')
        });
        const key = within(inspector).getByLabelText(amText('form-engine.settings.inspector.field.key'));
        await waitFor(() => expect(key).toBeDisabled());
        expect(
            within(inspector).getByText(amText('form-engine.settings.inspector.field.keyLocked'))
        ).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: amText('form-engine.designer.canvas.delete') }));
        // it stays on the canvas, marked removed
        expect(canvas.querySelector('[data-design-field="officeType"]')).not.toBeNull();
        expect(within(canvas).getByText(amText('form-engine.designer.removed.badge'))).toBeInTheDocument();
        await user.click(within(canvas).getByRole('button', { name: amText('form-engine.designer.removed.restore') }));
        expect(within(canvas).queryByText(amText('form-engine.designer.removed.badge'))).not.toBeInTheDocument();
    });

    it('saves the preview values as a test case with the expectation the engine gives', async () => {
        const user = userEvent.setup();
        publishedAnswers();
        open();
        await user.click(
            screen.getByRole('radio', { name: new RegExp(amText('form-engine.designer.toolbar.preview')) })
        );
        await user.type(screen.getByLabelText('Full name'), 'Abebe');
        await user.click(screen.getByRole('button', { name: amText('form-engine.designer.tests.saveAs') }));
        await user.type(screen.getByLabelText(amText('form-engine.designer.tests.name')), 'Plain request');
        await user.click(screen.getByRole('button', { name: amText('form-engine.designer.tests.save') }));
        await user.click(screen.getByRole('button', { name: amText('form-engine.designer.tests.button') }));
        const sheet = await screen.findByRole('dialog');
        expect(sheet.querySelector('[data-test-case="plain-request"]')).not.toBeNull();
        expect(within(sheet).getByText(amText('form-engine.designer.tests.passed'))).toBeInTheDocument();
    });
});

describe('PublishReview', () => {
    const check: PublishCheck = {
        canPublish: false,
        base: { id: 'v1', number: 1 },
        candidate: { id: null, number: null },
        problems: [
            {
                code: 'lint.cycle',
                severity: 'error',
                fieldId: 'a',
                path: 'fields[0]',
                message: 'a reads b and b reads a'
            },
            {
                code: 'lint.untranslated',
                severity: 'warning',
                fieldId: 'b',
                path: 'fields[1].label',
                message: 'No English text'
            }
        ],
        tests: [
            {
                id: 'one',
                name: 'Plain request',
                passed: false,
                mismatches: [{ path: 'valid', expected: true, actual: false }]
            }
        ],
        diff: {
            added: [],
            removed: [{ key: 'officeType', label: 'Office type', type: 'InputText' }],
            restored: [],
            changed: [
                {
                    key: 'fullName',
                    label: 'Full name',
                    changes: [{ area: 'label', before: 'Name', after: 'Full name' }]
                }
            ],
            form: []
        },
        impact: {
            views: [
                {
                    id: 'view-1',
                    name: 'Towns',
                    visibility: 'unit',
                    unit: { id: 'u-1', code: 'Z', name: { en: 'Zone' } },
                    mine: false,
                    keys: [{ key: 'officeType', reasons: ['filter'] }]
                }
            ]
        }
    };

    it('shows the blocking problems, warnings, tests, the diff and the affected views', () => {
        render(<PublishReview check={check} />);
        expect(screen.getByText('a reads b and b reads a')).toBeInTheDocument();
        expect(screen.getByText('No English text')).toBeInTheDocument();
        expect(screen.getByText('Plain request')).toBeInTheDocument();
        expect(screen.getByText(amText('form-engine.designer.publish.cannotPublish'))).toBeInTheDocument();
        const removed = screen.getByText(amText('form-engine.designer.publish.removed')).closest('li');
        expect(removed).toHaveTextContent('officeType');
        expect(screen.getByText('Towns')).toBeInTheDocument();
    });
});
