/** The plate exchange's workflow (task 1.2c, DVC-12): what the plate's life and ADR-0042 ask of it, whatever else a bureau changes. */
import { workflowDefinitionSchema } from '@itrms/schemas';
import { describe, expect, it } from 'vitest';

import { EXCHANGE_EFFECTS as X, REGISTRATION_EFFECTS as E } from '../contracts';
import { PLATE_EXCHANGE_FORM, plateExchangeFlow } from '../seed/exchange-service';

interface Step {
    from: string | readonly string[];
    to: string;
    action?: string;
    on?: string;
    guard?: unknown;
    effects?: readonly string[];
}

const flow = plateExchangeFlow('vehicle-plate-handover@1');
const steps = flow.transitions as readonly Step[];
const PAID = { fact: 'payment.settled', op: 'eq', value: true };

describe('the plate exchange workflow', () => {
    it('is a valid definition', () => {
        expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
    });

    it('checks the request when it is filed and when it is corrected', () => {
        const filing = steps.filter((t) => t.from === 'draft' && t.to === 'review');
        expect(filing.map((t) => t.action).sort()).toEqual(['correct', 'submit']);
        for (const t of filing) expect(t.effects).toContain(X.checkPlateExchange);
    });

    it('holds a plate at the final approval, hands it over only while the fee stands paid, and gives it back on rejection', () => {
        expect(steps.find((t) => t.from === 'approval' && t.action === 'approve')?.effects).toEqual([
            E.reserveRegistrationPlate
        ]);
        const exchange = steps.find((t) => t.action === 'exchange');
        expect(exchange).toMatchObject({ from: 'exchange', to: 'exchanged', guard: PAID, effects: [X.exchangePlate] });
        const rejections = steps.filter((t) => t.action === 'reject');
        expect(rejections).toHaveLength(1);
        expect(rejections[0]?.from).toEqual(['review', 'approval', 'exchange']);
        expect(rejections[0]?.effects).toEqual([E.releaseRegistrationPlate]);
    });

    it('keeps whoever filed or checked a case off its approval, and the approver off the exchange', () => {
        const state = (key: string) =>
            flow.states.find((s) => s.key === key) as { separationOfDuties?: string[]; stepForm?: string } | undefined;
        expect(state('approval')?.separationOfDuties?.sort()).toEqual(['draft', 'review']);
        expect(state('exchange')?.separationOfDuties).toEqual(['approval']);
        expect(state('exchange')?.stepForm).toBe('vehicle-plate-handover@1');
    });

    it('lets a draft be withdrawn, and closes a fee never paid', () => {
        expect(steps.some((t) => t.from === 'draft' && t.action === 'withdraw')).toBe(true);
        expect(steps.some((t) => t.from === 'payment' && t.on === 'timeout' && t.to === 'rejected')).toBe(true);
    });
});

describe('the plate exchange form', () => {
    it('picks the vehicle from the register and asks its use, both required, with the fee', () => {
        const field = (id: string) =>
            PLATE_EXCHANGE_FORM.fields.find((f) => f.id === id) as
                { type: string; props?: { required?: boolean; provider?: string } } | undefined;
        expect(field('vehicle')).toMatchObject({
            type: 'RegistryLookup',
            props: { provider: 'vehicle', required: true }
        });
        expect(field('use')).toMatchObject({ type: 'Dropdown', props: { required: true } });
        expect(field('fee')?.type).toBe('Fee');
    });
});
