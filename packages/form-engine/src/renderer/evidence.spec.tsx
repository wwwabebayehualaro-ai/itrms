import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({ ...(await original<typeof UI>()), useNotify: () => notify }));

import { EngineForm } from './EngineForm';
import { photoFrame } from './fields/evidence';
import { hostRenderer } from '../test-utils';

const renderWithQuery = hostRenderer({ language: 'en', languages: ['am', 'en'] });
const outcome = () => document.querySelector('[data-checklist-outcome]')?.textContent ?? '';

const field = (type: string, id: string, label: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label,
    category: 'Input',
    props: {},
    data: { defaultProps: {} },
    behavior: { validation: { supported: true } },
    layout: { options: { isContainer: false } },
    ...extra
});

const checklist = field('Checklist', 'inspection', 'Inspection', {
    props: {
        required: true,
        remarkOnFail: true,
        sections: [
            {
                key: 'brakes',
                title: 'Brakes',
                items: [
                    { key: 'service', text: 'Service brake', critical: true },
                    { key: 'parking', text: 'Parking brake' }
                ]
            }
        ]
    }
});

const form = (fields: Record<string, unknown>[], onFormSubmit = vi.fn().mockResolvedValue(undefined)) => {
    renderWithQuery(
        <EngineForm
            fields={fields as never}
            template={{ id: 'tpl-1', name: 'Bolo', form_config: { fields } } as never}
            onFormSubmit={onFormSubmit}
            submissionId="s1"
        />
    );
    return onFormSubmit;
};

describe('the checklist field (task 1.13a)', () => {
    it('answers each item, shows the outcome as the server works it out, and asks a remark of a failed item', async () => {
        const user = userEvent.setup();
        const submitted = form([checklist]);
        const answer = (item: string, value: 'Pass' | 'Fail' | 'Does not apply') =>
            user.click(
                within(screen.getByRole('radiogroup', { name: `Answer for ${item}` })).getByRole('radio', {
                    name: value
                })
            );

        expect(outcome()).toContain('Not finished: 0 of 2');
        await answer('1.1 Service brake', 'Pass');
        await answer('1.2 Parking brake', 'Fail');
        expect(outcome()).toContain('Failed: 1 of 2');
        expect(outcome()).toContain('Failed items: 1.2');

        // a failed item without its remark is refused at the submit
        await user.click(screen.getByRole('button', { name: /Submit|Save/ }));
        expect((await screen.findAllByText('Give a remark for each failed item: 1.2')).length).toBeGreaterThan(0);
        expect(submitted).not.toHaveBeenCalled();

        await user.type(screen.getByRole('textbox', { name: 'Remark for 1.2 Parking brake' }), 'Cable loose');
        await answer('1.2 Parking brake', 'Pass');
        expect(outcome()).toContain('Passed: 2 of 2');
        await user.click(screen.getByRole('button', { name: /Submit|Save/ }));
        await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
        expect(submitted.mock.calls[0]?.[0]).toMatchObject({
            submission_data: {
                inspection: {
                    items: { service: { result: 'pass' }, parking: { result: 'pass', remark: 'Cable loose' } }
                }
            }
        });
    });

    it('says so when its items are not set up, rather than showing an empty sheet', () => {
        form([field('Checklist', 'broken', 'Broken', { props: { sections: [] } })]);
        expect(screen.getByText("This checklist's items are not set up correctly.")).toBeTruthy();
    });
});

describe('the place field (task 1.13a)', () => {
    it('takes a place typed in as numbers, and refuses half a place', async () => {
        const user = userEvent.setup();
        const submitted = form([field('GeoPoint', 'at', 'Accident place', { props: { required: true } })]);
        await user.type(screen.getByRole('textbox', { name: 'Accident place: latitude' }), '6.8476');
        await user.click(screen.getByRole('button', { name: /Submit|Save/ }));
        expect((await screen.findAllByText('Enter a place with its latitude and longitude')).length).toBeGreaterThan(0);
        await user.type(screen.getByRole('textbox', { name: 'Accident place: longitude' }), '37.7524');
        await user.click(screen.getByRole('button', { name: /Submit|Save/ }));
        await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
        expect(submitted.mock.calls[0]?.[0]).toMatchObject({ submission_data: { at: { lat: 6.8476, lng: 37.7524 } } });
    });

    /** A device whose GPS answers with `answer`. */
    const device = (answer: (ok: PositionCallback, fail: PositionErrorCallback) => void) => {
        const before = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
        Object.defineProperty(navigator, 'geolocation', {
            configurable: true,
            value: { getCurrentPosition: answer }
        });
        return () => {
            if (before) Object.defineProperty(navigator, 'geolocation', before);
            else Reflect.deleteProperty(navigator, 'geolocation');
        };
    };

    it("takes the device's fix with how sure it was, to six decimals and whole metres", async () => {
        const user = userEvent.setup();
        const restore = device((ok) =>
            ok({ coords: { latitude: 6.847612345, longitude: 37.752398765, accuracy: 8.4 } } as GeolocationPosition)
        );
        try {
            const submitted = form([field('GeoPoint', 'at', 'Accident place', { props: { maxAccuracy: 20 } })]);
            await user.click(screen.getByRole('button', { name: 'Accident place' }));
            expect(screen.getByText('Within 8 m')).toBeTruthy();
            await user.click(screen.getByRole('button', { name: /Submit|Save/ }));
            await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
            expect(submitted.mock.calls[0]?.[0]).toMatchObject({
                submission_data: { at: { lat: 6.847612, lng: 37.752399, accuracy: 8 } }
            });
        } finally {
            restore();
        }
    });

    it('says when the device does not let its location be read', async () => {
        const user = userEvent.setup();
        const restore = device((_, fail) =>
            fail({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
        );
        try {
            form([field('GeoPoint', 'at', 'Accident place')]);
            await user.click(screen.getByRole('button', { name: 'Accident place' }));
            expect(screen.getByText('The device did not allow its location to be read.')).toBeTruthy();
        } finally {
            restore();
        }
    });
});

describe('a photo cropped to the face (task 1.13a)', () => {
    it('keeps the largest 3 × 4 frame, centred across and a little above the middle, at most 1600 pixels', () => {
        // a landscape phone photo: the full height, the middle three quarters of it across
        expect(photoFrame(4000, 3000, 'face')).toEqual({ sx: 875, sy: 0, sw: 2250, sh: 3000, w: 1200, h: 1600 });
        // a tall one: the full width, the frame sitting 40% of the way down what is left
        expect(photoFrame(1200, 2000, 'face')).toEqual({ sx: 0, sy: 160, sw: 1200, sh: 1600, w: 1200, h: 1600 });
        // the whole photo, made smaller only when it is large
        expect(photoFrame(800, 600, 'none')).toEqual({ sx: 0, sy: 0, sw: 800, sh: 600, w: 800, h: 600 });
        expect(photoFrame(3200, 2400, 'none')).toMatchObject({ w: 1600, h: 1200 });
    });
});
