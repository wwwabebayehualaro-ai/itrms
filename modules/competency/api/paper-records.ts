/**
 * What a vehicle that joins the register with the facts of a paper (a back-captured file, task 1.13) or of another region's document
 * (an arrival, task 1.4c3) must meet before it is written: the dates of its papers in order, the plate it carries read with the
 * region's old plate codes and no other vehicle's, and the libre it holds and no other vehicle's. Shared by BackCaptureService and
 * TransferArrivalService; the checks are the same words and the same refusals in both.
 */
import { and, eq, sql } from 'drizzle-orm';
import { currentContext } from '@itrms/kernel/context';
import type { Tx } from '@itrms/kernel/db';
import { ValidationError } from '@itrms/kernel/errors';
import { stationeryItems } from '@itrms/fees/api';
import { parseStationeryKey } from '@itrms/fees/contracts';
import { libres, plateAssignments, type PlateStock, type VehiclesService } from '@itrms/vehicles/api';
import { parsePlate } from '@itrms/vehicles/contracts';

import { addisDay } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';

type Words = keyof typeof am;

/** A refusal in the language of the person acting: this is what they read at the desk. */
const say = (key: Words): string => (currentContext()?.language === 'en' ? en : am)[key];

export type Refusal = { path: string; code: string; message: string };

export const refuse = (errors: Refusal[]): never => {
    throw new ValidationError('validation_failed', { errors });
};

/** A libre number as the register keeps it: a booklet serial folded (upper case, no spaces or hyphens), anything else trimmed. */
export const libreKey = (text: string): string => parseStationeryKey(text)?.key ?? text.trim();

/** The dates a paper gives. */
export type PaperDates = {
    firstRegisteredOn: string;
    ownersSince?: string;
    plateSince?: string;
    libreNumber?: string;
    libreIssuedOn?: string;
};

/** The dates of the file, in order: none in the future, none before the first registration, the libre not before its owners. */
export function checkPaperDates(input: PaperDates): void {
    const today = addisDay();
    const first = input.firstRegisteredOn;
    const errors: Refusal[] = [];
    const dates: [string, string | undefined][] = [
        ['firstRegisteredOn', first],
        ['ownersSince', input.ownersSince],
        ['plateSince', input.plateSince],
        ['libreIssuedOn', input.libreIssuedOn]
    ];
    for (const [path, day] of dates) {
        if (day === undefined) continue;
        if (day > today) errors.push({ path, code: 'in_future', message: say('competency.rule.notInFuture') });
        else if (day < first)
            errors.push({
                path,
                code: 'before_registration',
                message: say('competency.rule.beforeFirstRegistration')
            });
    }
    const owners = input.ownersSince ?? first;
    if (input.libreIssuedOn !== undefined && input.libreIssuedOn >= first && input.libreIssuedOn < owners)
        errors.push({
            path: 'libreIssuedOn',
            code: 'before_period',
            message: say('competency.rule.libreBeforeOwners')
        });
    if (input.libreNumber && input.libreIssuedOn === undefined)
        errors.push({ path: 'libreIssuedOn', code: 'required', message: say('competency.rule.libreIssuedOn') });
    if (errors.length > 0) refuse(errors);
}

/** The plate the paper records, read with the region's old plate codes; refused at its field when it is no plate. */
export async function plateOf(tx: Tx, vehicles: Pick<VehiclesService, 'legacyRegions'>, text: string) {
    const parsed = parsePlate(text, await vehicles.legacyRegions(tx));
    if (!parsed) refuse([{ path: 'plate', code: 'invalid_plate', message: say('competency.rule.notAnyPlate') }]);
    return parsed as NonNullable<typeof parsed>;
}

/**
 * A plate another vehicle of the register carries, or carried and gave up (an old plate is never handed out again), and a national
 * plate still in the stock (it was never handed over: it is issued from the stock, not captured).
 */
export async function checkPlateFree(
    tx: Tx,
    stock: Pick<PlateStock, 'inStock'>,
    regionId: string,
    plate: { key: string; format: string }
): Promise<void> {
    const [carried] = await tx
        .select({ until: plateAssignments.until })
        .from(plateAssignments)
        .where(and(eq(plateAssignments.regionId, regionId), eq(plateAssignments.plateKey, plate.key)))
        .orderBy(sql`${plateAssignments.until} is null desc`)
        .limit(1);
    if (carried)
        refuse([
            carried.until === null
                ? { path: 'plate', code: 'duplicate', message: say('competency.rule.plateOnRegister') }
                : { path: 'plate', code: 'plate_ended', message: say('competency.rule.plateEnded') }
        ]);
    if (plate.format === 'national' && (await stock.inStock(tx, regionId, plate.key)))
        refuse([{ path: 'plate', code: 'in_stock', message: say('competency.rule.plateInStock') }]);
}

/**
 * The libre the paper records: a booklet serial is kept folded, never one of the stationery's own booklets (those are issued
 * from the stock, not captured), and no other vehicle's libre has it.
 */
export async function checkLibreFree(tx: Tx, regionId: string, libreNumber: string | undefined): Promise<void> {
    const given = libreNumber?.trim();
    if (!given) return;
    const parsed = parseStationeryKey(given);
    if (parsed) {
        const [booklet] = await tx
            .select({ id: stationeryItems.id })
            .from(stationeryItems)
            .where(
                and(
                    eq(stationeryItems.regionId, regionId),
                    eq(stationeryItems.kind, 'libre_booklet'),
                    eq(stationeryItems.series, parsed.series),
                    eq(stationeryItems.serial, parsed.serial)
                )
            )
            .limit(1);
        if (booklet) refuse([{ path: 'libreNumber', code: 'in_stock', message: say('competency.rule.libreInStock') }]);
    }
    const [held] = await tx
        .select({ id: libres.id })
        .from(libres)
        .where(and(eq(libres.regionId, regionId), eq(libres.number, libreKey(given))))
        .limit(1);
    if (held) refuse([{ path: 'libreNumber', code: 'duplicate', message: say('competency.rule.libreOnRegister') }]);
}
