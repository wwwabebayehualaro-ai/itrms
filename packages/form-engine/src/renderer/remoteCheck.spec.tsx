import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), request: vi.fn() }));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({
    ...(await original<typeof UI>()),
    useNotify: () => notify
}));

import { REMOTE_PENDING, readDocument, validateForm } from '../core';
import { EngineForm } from './EngineForm';
import { hostRenderer, requestError } from '../test-utils';

const ALL = ['submission:update', 'submission:delete', 'submission:export', 'template:update', 'view:create'];
const renderWithQuery = hostRenderer({
    client,
    user: {
        id: 'u1',
        email: 'teller@example.org',
        full_name: 'Teller',
        roles: ['teller'],
        tenant_id: 't1',
        permissions: ALL
    }
});

const field = (type: string, id: string, extra: Record<string, any> = {}) => ({
    id,
    type,
    label: extra.label ?? id,
    category: 'Input',
    props: extra.props ?? {},
    data: { defaultProps: {}, ...extra.data },
    behavior: { validation: { supported: true, ...extra.validation } }
});

// the cash form in small: an account number checked by a lookup, the holder's name filled from it, an amount
const fields: any[] = [
    field('InputText', 'accountNumber', {
        label: 'Account number',
        props: { required: true },
        validation: { rules: { pattern: '^\\d{13}$' }, remote: { dataSourceId: 'account' } }
    }),
    field('InputText', 'holder', {
        label: 'Holder',
        props: { required: true },
        data: { computed: { expression: '{{data.account.holder_name | default:""}}', readOnly: true } }
    }),
    field('InputNumber', 'amount', { label: 'Amount', props: { required: true } })
];
const runtime: any = {
    dataSources: [
        {
            id: 'account',
            request: {
                method: 'GET',
                url: '/core-banking/accounts/{acct}',
                pathParams: { acct: '{{form.accountNumber}}' }
            },
            enabledWhen: [{ field: 'accountNumber', operator: 'regex', value: '^\\d{13}$' }],
            cache: { staleTimeMs: 0 },
            errorMapping: { statusMessages: { '404': 'Account not found' } }
        }
    ],
    submit: {
        serverAction: 'core_banking.cash_transaction',
        successMessage: '{{response.submission_data.postingStatus}}: {{response.submission_data.reference}}'
    }
};
const template = { id: 'tpl-cash', name: 'Cash', form_config: { fields, runtime } } as any;

client.request.mockImplementation((req: { url: string }) => {
    if (req.url.endsWith('/1000000000001'))
        return Promise.resolve({ data: { holder_name: 'Abebe Kebede', status: 'ACTIVE' } });
    return Promise.reject(
        Object.assign(new Error('Request failed'), {
            response: { status: 404, data: { detail: 'Account not found' } }
        })
    );
});

describe('a field checked by a data source', () => {
    it('is valid only once its lookup succeeded', () => {
        const doc = readDocument({ fields });
        const values = { accountNumber: '1000000000001', holder: 'A', amount: 5 };
        expect(validateForm(doc.fields, values, { status: { account: { state: 'loading' } } }).accountNumber).toBe(
            REMOTE_PENDING
        );
        expect(
            validateForm(doc.fields, values, { status: { account: { state: 'error', error: 'Account not found' } } })
                .accountNumber
        ).toBe('Account not found');
        expect(validateForm(doc.fields, values, { status: { account: { state: 'success' } } })).toEqual({});
        expect(
            validateForm(doc.fields, { ...values, accountNumber: '' }, { status: { account: { state: 'error' } } })
                .accountNumber
        ).toBe('This field is required');
    });

    it('fills from the lookup, shows its error on the field and blocks the submit', async () => {
        const user = userEvent.setup();
        const onFormSubmit = vi
            .fn()
            .mockResolvedValue({ submission_data: { reference: 'TXN-2026-000001', postingStatus: 'Posted' } });
        renderWithQuery(<EngineForm fields={fields} template={template} onFormSubmit={onFormSubmit} />);

        await user.type(screen.getByLabelText(/Account number/), '9999999999999');
        expect(await screen.findByText('Account not found')).toBeInTheDocument();
        await user.type(screen.getByLabelText(/Amount/), '1500');
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        expect(onFormSubmit).not.toHaveBeenCalled();

        await user.clear(screen.getByLabelText(/Account number/));
        await user.type(screen.getByLabelText(/Account number/), '1000000000001');
        expect(await screen.findByText('Verified')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText(/Holder/)).toHaveValue('Abebe Kebede'));
        expect(screen.queryByText('Account not found')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Submit' }));
        await waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
        expect(onFormSubmit.mock.calls[0]?.[0].submission_data).toEqual({
            accountNumber: '1000000000001',
            holder: 'Abebe Kebede',
            amount: 1500
        });
        // the message shows what the server did
        expect(notify.success).toHaveBeenCalledWith('Posted: TXN-2026-000001');
    });

    it('shows the server’s verdict on the field it is about', async () => {
        const user = userEvent.setup();
        const refused = requestError(422, {
            detail: 'Exceeds the available balance',
            errors: [{ field: 'amount', message: 'Exceeds the available balance (500.00 USD)' }]
        });
        const onFormSubmit = vi.fn().mockRejectedValue(refused);
        renderWithQuery(<EngineForm fields={fields} template={template} onFormSubmit={onFormSubmit} />);

        await user.type(screen.getByLabelText(/Account number/), '1000000000001');
        await screen.findByText('Verified');
        await user.type(screen.getByLabelText(/Amount/), '900');
        await user.click(screen.getByRole('button', { name: 'Submit' }));
        expect(await screen.findByText('Exceeds the available balance (500.00 USD)')).toBeInTheDocument();

        await user.type(screen.getByLabelText(/Amount/), '0'); // a new value: the old verdict goes away
        await waitFor(() =>
            expect(screen.queryByText('Exceeds the available balance (500.00 USD)')).not.toBeInTheDocument()
        );
    });
});
