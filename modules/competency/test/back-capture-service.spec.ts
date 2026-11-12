/**
 * The back-capture service's configuration (ADR-0054, task 1.13, MIG-01): what the decision asks of it, whatever else a bureau
 * changes later. A second person verifies before the vehicle joins the register; the capture keeps its paper.
 */
import { workflowDefinitionSchema } from '@itrms/schemas';
import { describe, expect, it } from 'vitest';

import { BACK_CAPTURE_EFFECTS as B } from '../contracts';
import { BACK_CAPTURE_FORM, backCaptureFlow } from '../seed/back-capture-service';
import { VEHICLE_REGISTRATION_FORM } from '../seed/vehicle-services';

interface Step {
    from: string | readonly string[];
    to: string;
    action?: string;
    effects?: readonly string[];
    commentRequired?: boolean;
}

const flow = backCaptureFlow();
const steps = flow.transitions as readonly Step[];
const field = (id: string) =>
    BACK_CAPTURE_FORM.fields.find((f) => f.id === id) as { type: string; props: { required?: boolean } } | undefined;

describe('the back-capture workflow', () => {
    it('is a valid definition', () => {
        expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
    });

    it('puts the vehicle on the register only on the second person’s verification (ADR-0054)', () => {
        const capturing = steps.filter((t) => t.effects?.includes(B.backCaptureVehicle));
        expect(capturing.map((t) => [t.from, t.action, t.to])).toEqual([['verification', 'verify', 'captured']]);
        const verification = flow.states.find((s) => s.key === 'verification') as
            { separationOfDuties?: string[] } | undefined;
        // whoever captured the file is kept off its verification
        expect(verification?.separationOfDuties).toEqual(['draft']);
    });

    it('checks the capture when it is filed and when it is corrected', () => {
        const filing = steps.filter((t) => t.from === 'draft' && t.to === 'verification');
        expect(filing.map((t) => t.action).sort()).toEqual(['correct', 'submit']);
        for (const t of filing) expect(t.effects).toEqual([B.checkBackCapture]);
    });

    it('sends a capture that does not match the paper back, or rejects it, with the reason', () => {
        const back = steps.filter((t) => t.from === 'verification' && t.action !== 'verify');
        expect(back.map((t) => [t.action, t.to])).toEqual([
            ['return', 'draft'],
            ['reject', 'rejected']
        ]);
        for (const t of back) expect(t.commentRequired).toBe(true);
        expect(steps.some((t) => t.from === 'draft' && t.action === 'withdraw')).toBe(true);
    });
});

describe('the back-capture form', () => {
    it('asks for the paper file’s reference, its scan and its first registration, all required', () => {
        expect(field('paperReference')?.props.required).toBe(true);
        expect(field('paperFileScan')).toMatchObject({ type: 'FileUpload', props: { required: true } });
        expect(field('firstRegisteredOn')).toMatchObject({ type: 'EthDate', props: { required: true } });
        expect(field('plate')?.props.required).toBe(true);
    });

    it('takes the vehicle’s facts as a registration does, with no fee and no check-digit box', () => {
        const ids = new Set(BACK_CAPTURE_FORM.fields.map((f) => f.id));
        for (const id of ['chassisNumber', 'make', 'model', 'modelYear', 'categoryKey', 'use', 'owners'])
            expect(ids.has(id)).toBe(true);
        expect(ids.has('fee')).toBe(false);
        expect(ids.has('chassisMismatchConfirmed')).toBe(false);
        // the same field as the registration's, so a refusal of the register points at the same box
        const chassis = VEHICLE_REGISTRATION_FORM.fields.find((f) => f.id === 'chassisNumber');
        expect(BACK_CAPTURE_FORM.fields.find((f) => f.id === 'chassisNumber')).toBe(chassis);
    });

    it('leaves what a paper file may not give optional', () => {
        for (const id of ['ownersSince', 'plateSince', 'libreNumber', 'libreIssuedOn', 'federalVehicleId', 'seats'])
            expect(field(id)?.props.required).toBe(false);
    });
});
