import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({ ...(await original<typeof UI>()), useNotify: () => notify }));

import { FeeSourceProvider, useLatestFee, type FeePreview } from '../host/fees';
import { amText, hostRenderer, requestError } from '../test-utils';
import { EngineForm } from './EngineForm';

const text = (id: string, label: string) => ({
    id,
    type: 'InputText',
    label,
    category: 'Input',
    classification: 'personal' as const,
    props: {},
    data: { defaultProps: {} },
    behavior: { validation: { supported: true } },
    layout: { options: { isContainer: false } }
});
const feeField = {
    id: 'fee',
    type: 'Fee',
    label: 'Fee',
    category: 'Data',
    props: { showLines: true },
    data: { defaultProps: {} },
    layout: { options: { isContainer: false } }
};
const fields = [text('weight', 'Weight'), text('note', 'Note'), feeField];

const preview = (extra: Partial<FeePreview> = {}): FeePreview => ({
    status: 'complete',
    serviceVersionId: 'sv-1',
    feeRuleVersionId: 'rule-1',
    asOf: '2026-11-01',
    demo: false,
    inputKeys: ['weight'],
    lines: [
        { key: 'base', label: { am: 'መሠረታዊ ክፍያ', en: 'Base fee' }, quantity: null, amountSantim: '100000' },
        { key: 'extra', label: { am: 'ተጨማሪ', en: 'Extra' }, quantity: 2, amountSantim: '25050' }
    ],
    totalSantim: '125050',
    missing: [],
    problem: null,
    ...extra
});
const reply = (data: FeePreview) => Promise.resolve({ data, status: 200, headers: {} });

const Latest = () => {
    const latest = useLatestFee();
    return <span data-testid="latest">{latest ? `${latest.ruleVersionId}:${latest.totalSantim}` : ''}</span>;
};

function show(post: ReturnType<typeof vi.fn>, withSource = true) {
    const onFormSubmit = vi
        .fn<(submission: { submission_data: Record<string, unknown> }) => Promise<void>>()
        .mockResolvedValue(undefined);
    const form = (
        <>
            <EngineForm
                fields={fields}
                template={{ id: 'tpl-1', name: 'Licence', form_config: { fields } } as never}
                onFormSubmit={onFormSubmit}
                initialValues={{ weight: '10', note: 'a' }}
            />
            <Latest />
        </>
    );
    hostRenderer({ client: { post: post as never } })(
        withSource ? (
            <FeeSourceProvider source={{ kind: 'request', serviceCode: 'DL-1' }}>{form}</FeeSourceProvider>
        ) : (
            form
        )
    );
    return onFormSubmit;
}

/** Lets the debounce pass and the answers arrive. */
const settle = (ms = 500) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
/** The first ask (no answers: it learns the inputs), then the ask with the inputs' answers. */
const ready = async () => {
    await settle();
    await settle();
};
const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });
const region = () => screen.getByRole('group', { name: 'Fee' });

describe('the Fee field (task 0.22a)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows the lines and the total as Birr, the demo badge, and tells the screen the figure shown', async () => {
        const post = vi.fn(() => reply(preview({ demo: true })));
        show(post);
        await ready();
        expect(post).toHaveBeenCalledWith(
            'v1/fees/preview',
            expect.objectContaining({ serviceCode: 'DL-1' }),
            expect.objectContaining({ signal: expect.anything() as unknown })
        );
        expect(region().textContent).toContain('መሠረታዊ ክፍያ');
        expect(region().textContent).toContain('1,000.00');
        expect(region().textContent).toContain('250.50');
        expect(region().textContent).toContain(`${amText('form-engine.renderer.fee.total')}1,250.50`);
        expect(region().textContent).toContain(amText('form-engine.renderer.fee.demo'));
        expect(screen.getByRole('status').textContent).toBe(`${amText('form-engine.renderer.fee.total')} 1,250.50`);
        expect(screen.getByTestId('latest').textContent).toBe('rule-1:125050');
    });

    it('asks once per change of an input the preview named, and not for another field', async () => {
        const post = vi.fn<(url: string, body: unknown) => Promise<unknown>>(() => reply(preview()));
        show(post);
        await ready();
        // the first ask sends no answer: an answer the fee does not read (a Sensitive one) never leaves the form
        expect(post.mock.calls[0]?.[1]).toEqual({ serviceCode: 'DL-1', answers: {} });
        expect(post.mock.calls[1]?.[1]).toEqual({ serviceCode: 'DL-1', answers: { weight: '10' } });
        expect(post).toHaveBeenCalledTimes(2);

        type('Note', 'another note');
        await settle(1000);
        expect(post).toHaveBeenCalledTimes(2);

        type('Weight', '2');
        type('Weight', '20');
        await settle(200);
        expect(post).toHaveBeenCalledTimes(2);
        await settle(300);
        expect(post).toHaveBeenCalledTimes(3);
        expect(post.mock.calls[2]?.[1]).toEqual({ serviceCode: 'DL-1', answers: { weight: '20' } });
    });

    it('keeps the last figure, marked busy, while the next is worked out', async () => {
        let release: (data: FeePreview) => void = () => undefined;
        const post = vi
            .fn<(url: string, body: unknown) => Promise<unknown>>()
            .mockImplementationOnce(() => reply(preview()))
            .mockImplementationOnce(() => reply(preview()))
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        release = (data) => resolve({ data, status: 200, headers: {} });
                    })
            );
        show(post);
        await ready();
        expect(region().getAttribute('aria-busy')).toBe('false');

        type('Weight', '30');
        await settle();
        expect(region().getAttribute('aria-busy')).toBe('true');
        expect(region().textContent).toContain('1,250.50');

        release(preview({ totalSantim: '200000', lines: [] }));
        await settle(10);
        expect(region().getAttribute('aria-busy')).toBe('false');
        expect(region().textContent).toContain('2,000.00');
    });

    it('says what failed and asks again on Retry', async () => {
        const post = vi
            .fn<(url: string, body: unknown) => Promise<unknown>>(() => reply(preview()))
            .mockRejectedValueOnce(requestError(500, {}));
        show(post);
        await settle();
        expect(region().textContent).toContain(amText('form-engine.renderer.fee.failed'));
        expect(screen.getByTestId('latest').textContent).toBe('');

        fireEvent.click(screen.getByRole('button', { name: amText('form-engine.renderer.fee.retry') }));
        await ready();
        expect(post.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(region().textContent).toContain('1,250.50');
    });

    it('names the fields still to fill in by their labels', async () => {
        const post = vi.fn(() =>
            reply(preview({ status: 'incomplete', missing: ['weight'], lines: [], totalSantim: null }))
        );
        show(post);
        await ready();
        expect(region().textContent).toContain(amText('form-engine.renderer.fee.incomplete', { fields: 'Weight' }));
    });

    it('says the service has no fee', async () => {
        show(vi.fn(() => reply(preview({ status: 'none', lines: [], totalSantim: null, inputKeys: [] }))));
        await settle();
        expect(region().textContent).toContain(amText('form-engine.renderer.fee.none'));
    });

    it('says the fee is worked out on filing when the screen names no service, and asks nothing', async () => {
        const post = vi.fn();
        show(post, false);
        await settle();
        expect(region().textContent).toContain(amText('form-engine.renderer.fee.noSource'));
        expect(post).not.toHaveBeenCalled();
    });

    it('is not part of what is submitted', async () => {
        const onFormSubmit = show(vi.fn(() => reply(preview())));
        await ready();
        fireEvent.click(screen.getByRole('button', { name: amText('form-engine.renderer.submit.label') }));
        await settle(10);
        expect(onFormSubmit).toHaveBeenCalledTimes(1);
        const data = onFormSubmit.mock.calls[0]?.[0].submission_data ?? {};
        expect(Object.keys(data)).not.toContain('fee');
        expect(data).toMatchObject({ weight: '10' });
    });
});
