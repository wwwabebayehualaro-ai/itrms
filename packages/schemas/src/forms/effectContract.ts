/**
 * An effect's input contract (form-platform.md §3; task 0.21d): what a module's effect reads from the request form a
 * service names, by field key: the kind of value (the form engine's value kinds) and whether it must be there. A service
 * version maps each contract path to a form key (the same key by default); publishing a service version, or a new version
 * of a form a service's effects read, fails while the form does not meet the contract; the builder shows the fields locked
 * (their key, type and required-ness). The effect is given the values, checked against the contract.
 */
import { z } from 'zod';

/** The kinds of value a contract field may ask for (the form engine's `ValueKind`). */
export const CONTRACT_KINDS = [
    'text',
    'number',
    'boolean',
    'date',
    'datetime',
    'ethdate',
    'choice',
    'multi',
    'range',
    'files',
    'rows',
    'ref'
] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

/** A contract path: a field key (letters, digits, underscores). */
export const CONTRACT_PATH = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const contractFieldSchema = z.strictObject({
    kind: z.enum(CONTRACT_KINDS),
    /** the effect cannot run without it (default): the field is required and never hidden by a condition */
    required: z.boolean().default(true)
});
export type ContractField = z.input<typeof contractFieldSchema>;

export const effectContractSchema = z.record(
    z.string().regex(CONTRACT_PATH, 'is not a field key'),
    contractFieldSchema
);
export type EffectContract = Readonly<Record<string, ContractField>>;

/** A service version's mapping of an effect's contract paths to the request form's keys (a path maps to itself by default). */
export const inputMapSchema = z.record(
    z.string(),
    z.record(z.string().regex(CONTRACT_PATH), z.string().regex(CONTRACT_PATH))
);
export type InputMap = z.infer<typeof inputMapSchema>;

/** Why a form does not meet a contract field. */
export const CONTRACT_PROBLEMS = ['missing', 'wrong_kind', 'not_required', 'conditional'] as const;
export type ContractProblemCode = (typeof CONTRACT_PROBLEMS)[number];

export interface ContractProblem {
    /** the contract's path */
    path: string;
    /** the form key it maps to */
    key: string;
    code: ContractProblemCode;
    /** what the contract asks for, and what the form has (for `wrong_kind`) */
    expected?: ContractKind;
    actual?: string | null;
}
