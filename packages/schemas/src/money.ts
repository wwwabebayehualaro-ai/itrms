/**
 * Money (ADR-0014): integer santim (1 Birr = 100 santim), a `bigint` in code and a `bigint` column in the database. On
 * the wire and in JSON documents an amount is its santim as a string of digits ("12500" is 125.00 Birr), so it never
 * passes through a JS number.
 */
import { z } from 'zod';

export type Money = bigint;

/** At most 15 digits of Birr (as `packages/ui`'s money input): far above any fee, well inside a Postgres bigint. */
export const MAX_SANTIM: Money = 10n ** 17n - 1n;

/** An amount as text: santim, no sign, no leading zeros, at most 17 digits. */
export const santimTextSchema = z.string().regex(/^(0|[1-9]\d{0,16})$/, 'is not an amount in santim');

/** An amount read from its text, as `bigint` santim. */
export const moneySchema = santimTextSchema.transform((v) => BigInt(v));

/** The text of an amount (for the wire and JSON documents). */
export const santimText = (amount: Money): string => amount.toString();
