/**
 * The bulk import of paper vehicle files (ADR-0054, task 1.13b). A clerk sends a sheet (CSV or a workbook) with the scans of its
 * files; the worker reads it and checks every row as a back-capture (MIG-01) is checked, without writing a vehicle: the dry run,
 * whose report gives each row's errors. A second person (never the one who sent it, SEC-AC-6) commits the batch, and the worker
 * puts each valid row on the register, migrated by import, that person its verifier. Every step runs in the worker (imports never
 * run in a request), on the app's pool under RLS with the context and the rights of the person who asked, as they hold them then.
 *
 * Idempotent: a retried job carries on from the rows it has (each chunk of rows is one transaction, and a row is never read twice);
 * a committed row is never committed again; a paper file already imported (its chassis on the register from an import with the same
 * paper reference) is reported as already imported, so a sheet sent again makes nothing new.
 *
 * Owners: a person is found by their FIN, or made at the commit; the rows of one owner (the same FIN, or the same Amharic name with
 * the same phone) are one person. A possible duplicate of someone on the register is an error for a person to resolve (the FIN on
 * the sheet, or the file captured by hand). An organisation must already be on the register, found by its TIN. The owner's phone and
 * FIN are kept encrypted in the row, and the sheet itself only until it is read.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { currentContext, runInContext, type Language } from '@itrms/kernel/context';
import { FIELD_CRYPTO, type FieldCrypto } from '@itrms/kernel/crypto';
import { insertAudited, newId, updateAudited, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import {
    AppError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    RateLimitedError,
    ValidationError
} from '@itrms/kernel/errors';
import { downloadLinkedFile, files, linkFile, type ObjectStore } from '@itrms/kernel/files';
import { emit } from '@itrms/kernel/outbox';
import { users } from '@itrms/kernel/tables';
import { effectiveServices, unitRefs } from '@itrms/kernel/org';
import { organisations, PersonsService } from '@itrms/parties/api';
import { vehicleCategories, vehicles, VehiclesService } from '@itrms/vehicles/api';
import { parsePlate, parseVin } from '@itrms/vehicles/contracts';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';
import partiesAm from '@itrms/parties/messages/am';
import partiesEn from '@itrms/parties/messages/en';

import {
    BACK_CAPTURE_SERVICE,
    IMPORT_CHUNK,
    type ImportFailure,
    type ImportRowError,
    type ImportRowState,
    type VehicleImport,
    type VehicleImportCreate,
    type VehicleImportRow
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { BackCaptureService, PLACEHOLDER_ID, type BackCaptureInput, type CapturePlace } from './back-capture.service';
import { vehicleImportRows, vehicleImports } from './competency.table';
import {
    columnOfPath,
    ownerKeyOf,
    readRow,
    type CellError,
    type ImportOwner,
    type ImportSensitive,
    type ImportValues
} from './import-rows';
import { readSheet, type SheetRecord } from './import-sheet';

type ImportRow = typeof vehicleImports.$inferSelect;
type RowRecord = typeof vehicleImportRows.$inferSelect;

/** What the worker needs besides the services: the app's pool (the work runs under RLS, as the person who asked). */
export interface ImportDeps {
    database: Database;
    /** what roles give (the installation's role catalogue) */
    permissionsOf: (roles: readonly string[]) => ReadonlySet<string>;
}

/** A batch as the worker loads it (handlers/vehicle-import.ts): its actor's context, and the roles they asked with and still hold. */
export interface LoadedImport {
    batch: ImportRow;
    ctx: DbContext;
    roles: string[];
}

/** The batches one person may have waiting for the worker at a time. */
export const MAX_CHECKING_IMPORTS = 3;
const IMPORT_LOCK = 0x1e8b;
const SCAN_DOCUMENT = 'paper_file_scan';
const IMPORTS_TABLE = 'competency.vehicle_imports';

const contentPlace = (id: string) => `competency.vehicle_imports.content_ct:${id}`;
const sensitivePlace = (id: string) => `competency.vehicle_import_rows.sensitive_ct:${id}`;

/** A catalogue's text in a language, its `{params}` filled in; the key itself when no catalogue has it. */
const CATALOGUES: Record<'am' | 'en', Record<string, string>> = {
    am: { ...vehiclesAm, ...partiesAm, ...am },
    en: { ...vehiclesEn, ...partiesEn, ...en }
};
function words(
    language: string,
    key: string,
    params: Readonly<Record<string, string | number>> = {}
): string | undefined {
    const text = (language === 'en' ? CATALOGUES.en : CATALOGUES.am)[key];
    return text?.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole));
}
const languageNow = (): string => currentContext()?.language ?? 'am';

/** A cell's error as the report shows it, in the batch's language. */
const cellError = (e: CellError): ImportRowError => ({
    column: e.column,
    code: e.code,
    message: words(languageNow(), `competency.import.error.${e.code}`, e.params ?? {}) ?? e.code
});

/** A refusal of the register's rules as the row's errors: each field error at its column, or the refusal as a whole. */
function refusalErrors(error: AppError): ImportRowError[] {
    const language = languageNow();
    if (error.errors?.length)
        return error.errors.map((e) => ({
            column: columnOfPath(e.path),
            code: e.code,
            message:
                (e.code === 'possible_duplicate'
                    ? words(language, 'competency.import.error.owner_possible_duplicate')
                    : undefined) ?? e.message
        }));
    const message =
        (error.detailKey ? words(language, error.detailKey, error.params ?? {}) : undefined) ??
        error.detail ??
        words(language, `kernel.errors.${error.code}`) ??
        error.code;
    return [{ column: null, code: error.code, message }];
}

const fold = (text: string) => text.normalize('NFC').trim().toLowerCase();

/**
 * A scan's name as it is matched: folded, its separators alike. A file name cannot hold a `/` (kernel.files), so the scan of the
 * paper reference `BOD/VEH/000123` is named `BOD-VEH-000123.pdf` (or with `_` or spaces), and found by it.
 */
function scanKey(text: string): string {
    let key = '';
    for (const c of fold(text)) {
        const separator = c === '/' || c === '\\' || c === '_' || c === '-' || c.trim() === '';
        if (!separator) key += c;
        else if (!key.endsWith('-')) key += '-';
    }
    return key;
}

/** What one row of the sheet comes to in the dry run. */
interface Verdict {
    state: Exclude<ImportRowState, 'imported'>;
    errors: ImportRowError[];
    paperReference: string | null;
    values: Record<string, unknown>;
    sensitive: ImportSensitive;
    ownerKey?: string;
    vinKey?: string;
    plateKey?: string;
    libreKey?: string;
    scanFileId?: string;
    vehicleId?: string;
}

/** What the rows read so far hold, to find a second row of the same file, chassis, plate, libre, scan or owner. */
interface Seen {
    paper: Map<string, number>;
    vin: Map<string, number>;
    plate: Map<string, number>;
    libre: Map<string, number>;
    scan: Map<string, number>;
    owner: Map<string, string>;
}

@Injectable()
export class VehicleImportService {
    constructor(
        @Inject(BackCaptureService) private readonly capture: BackCaptureService,
        @Inject(PersonsService) private readonly persons: PersonsService,
        @Inject(VehiclesService) private readonly vehicles: VehiclesService,
        @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto
    ) {}

    // ---- the requests ----

    /** A sheet sent: kept (encrypted) for the worker to read and check; nothing of it is on the register. */
    async create(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        language: Language,
        input: VehicleImportCreate,
        mayCommit: boolean
    ): Promise<VehicleImport> {
        const userId = required(ctx.userId);
        const regionId = required(ctx.regionId);
        // the import is the back-capture's, many files at once: only an office that offers it (ADR-0026: its services)
        if (!(await effectiveServices(tx, required(ctx.unitId))).includes(BACK_CAPTURE_SERVICE))
            throw new ForbiddenError({ detailKey: 'competency.errors.import_not_offered' });
        await tx.execute(sql`select pg_advisory_xact_lock(${IMPORT_LOCK}, hashtext(${userId}))`);
        const [waiting] = await tx
            .select({ n: count() })
            .from(vehicleImports)
            .where(and(eq(vehicleImports.createdBy, userId), eq(vehicleImports.state, 'checking')));
        if ((waiting?.n ?? 0) >= MAX_CHECKING_IMPORTS)
            throw new RateLimitedError(30, {
                detailKey: 'competency.errors.imports_waiting',
                params: { max: MAX_CHECKING_IMPORTS }
            });
        if (input.format === 'xlsx' && !/^[A-Za-z0-9+/]+={0,2}$/.test(input.content))
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'content', code: 'invalid_string', message: 'a workbook is sent in base64' }]
            });
        const scanIds = [...new Set(input.scanFileIds)];
        await this.checkScans(tx, userId, scanIds);
        const id = newId();
        await insertAudited(tx, vehicleImports, {
            id,
            regionId,
            handlingUnitId: required(ctx.unitId),
            filename: input.filename,
            format: input.format,
            contentCt: await this.crypto.encrypt(tx, regionId, contentPlace(id), input.content),
            scanFileIds: scanIds,
            language,
            roles: [...roles]
        });
        await emit(tx, 'vehicle-import.check-requested.v1', { importId: id });
        return this.get(tx, ctx, id, mayCommit);
    }

    /** The scans must be the sender's own uploads, stored and not yet any record's (they are linked to the batch when it is read). */
    private async checkScans(tx: Tx, userId: string, ids: readonly string[]): Promise<void> {
        if (ids.length === 0) return;
        const found = new Map(
            (
                await tx
                    .select({
                        id: files.id,
                        status: files.status,
                        origin: files.origin,
                        createdBy: files.createdBy,
                        linkedId: files.linkedId
                    })
                    .from(files)
                    .where(inArray(files.id, [...ids]))
            ).map((f) => [f.id, f])
        );
        const errors = ids.flatMap((id, i) => {
            const file = found.get(id);
            const ok =
                file?.status === 'stored' && file.origin === 'upload' && file.createdBy === userId && !file.linkedId;
            return ok
                ? []
                : [
                      {
                          path: `scanFileIds.${i}`,
                          code: 'invalid_file',
                          message: say('competency.import.error.scan_unusable')
                      }
                  ];
        });
        if (errors.length > 0) throw new ValidationError('validation_failed', { errors: errors.slice(0, 50) });
    }

    async list(tx: Tx, ctx: DbContext, limit: number, mayCommit: boolean): Promise<VehicleImport[]> {
        const rows = await tx
            .select()
            .from(vehicleImports)
            .orderBy(sql`${vehicleImports.createdAt} desc`, sql`${vehicleImports.id} desc`)
            .limit(limit);
        return this.out(tx, ctx, rows, mayCommit);
    }

    async get(tx: Tx, ctx: DbContext, id: string, mayCommit: boolean): Promise<VehicleImport> {
        const [row] = await tx.select().from(vehicleImports).where(eq(vehicleImports.id, id));
        if (!row) throw new NotFoundError();
        const [out] = await this.out(tx, ctx, [row], mayCommit);
        if (!out) throw new NotFoundError();
        return out;
    }

    private async out(tx: Tx, ctx: DbContext, rows: ImportRow[], mayCommit: boolean): Promise<VehicleImport[]> {
        if (rows.length === 0) return [];
        const ids = rows.map((r) => r.id);
        const counted = await tx
            .select({ importId: vehicleImportRows.importId, state: vehicleImportRows.state, n: count() })
            .from(vehicleImportRows)
            .where(inArray(vehicleImportRows.importId, ids))
            .groupBy(vehicleImportRows.importId, vehicleImportRows.state);
        const used = await tx
            .select({ importId: vehicleImportRows.importId, n: count() })
            .from(vehicleImportRows)
            .where(and(inArray(vehicleImportRows.importId, ids), isNotNull(vehicleImportRows.scanFileId)))
            .groupBy(vehicleImportRows.importId);
        const people = [...new Set(rows.flatMap((r) => [r.createdBy, r.committedBy].filter((v): v is string => !!v)))];
        const names = new Map(
            people.length === 0
                ? []
                : (
                      await tx
                          .select({ id: users.id, name: users.displayName })
                          .from(users)
                          .where(inArray(users.id, people))
                  ).map((u) => [u.id, u.name])
        );
        const units = await unitRefs(
            tx,
            rows.map((r) => r.handlingUnitId)
        );
        return rows.map((r) => {
            const of = (state: ImportRowState) => counted.find((c) => c.importId === r.id && c.state === state)?.n ?? 0;
            const counts = {
                valid: of('valid'),
                invalid: of('invalid'),
                alreadyImported: of('already_imported'),
                imported: of('imported')
            };
            const person = (id: string | null) => (id ? { id, name: names.get(id) ?? '' } : null);
            return {
                id: r.id,
                version: r.rowVersion,
                filename: r.filename,
                format: r.format,
                state: r.state,
                failure: r.failureCode ? { code: r.failureCode, columns: r.failureColumns } : null,
                counts: { total: counts.valid + counts.invalid + counts.alreadyImported + counts.imported, ...counts },
                scans: { given: r.scanFileIds.length, used: used.find((u) => u.importId === r.id)?.n ?? 0 },
                unit: units.get(r.handlingUnitId) ?? { id: r.handlingUnitId, code: '', name: {} },
                createdBy: person(r.createdBy) ?? { id: PLACEHOLDER_ID, name: '' },
                createdAt: r.createdAt.toISOString(),
                committedBy: person(r.committedBy),
                committedAt: r.committedAt?.toISOString() ?? null,
                mayCommit: mayCommit && r.state === 'checked' && counts.valid > 0 && r.createdBy !== ctx.userId
            };
        });
    }

    /** The report: the batch's rows in the sheet's order, of one state or all. */
    async rows(
        tx: Tx,
        id: string,
        query: { state?: ImportRowState; limit: number; offset: number }
    ): Promise<{ items: VehicleImportRow[]; total: number }> {
        const [batch] = await tx
            .select({ id: vehicleImports.id })
            .from(vehicleImports)
            .where(eq(vehicleImports.id, id));
        if (!batch) throw new NotFoundError();
        const where = and(
            eq(vehicleImportRows.importId, id),
            ...(query.state ? [eq(vehicleImportRows.state, query.state)] : [])
        );
        const [total] = await tx.select({ n: count() }).from(vehicleImportRows).where(where);
        const rows = await tx
            .select()
            .from(vehicleImportRows)
            .where(where)
            .orderBy(asc(vehicleImportRows.line))
            .limit(query.limit)
            .offset(query.offset);
        return { items: await this.rowsOut(tx, rows), total: total?.n ?? 0 };
    }

    /** One row, with the batch it is in (the vehicle record links to it). */
    async row(tx: Tx, rowId: string): Promise<VehicleImportRow & { importId: string }> {
        const [row] = await tx.select().from(vehicleImportRows).where(eq(vehicleImportRows.id, rowId));
        if (!row) throw new NotFoundError();
        const [out] = await this.rowsOut(tx, [row]);
        if (!out) throw new NotFoundError();
        return { ...out, importId: row.importId };
    }

    private async rowsOut(tx: Tx, rows: RowRecord[]): Promise<VehicleImportRow[]> {
        const scanIds = rows.flatMap((r) => (r.scanFileId ? [r.scanFileId] : []));
        const scans = new Map(
            scanIds.length === 0
                ? []
                : (
                      await tx
                          .select({ id: files.id, filename: files.filename })
                          .from(files)
                          .where(inArray(files.id, scanIds))
                  ).map((f) => [f.id, f.filename])
        );
        return rows.map((r) => {
            const values = r.values as Partial<ImportValues> & { owner?: ImportOwner };
            return {
                id: r.id,
                line: r.line,
                state: r.state,
                paperReference: r.paperReference,
                plate: values.plate ?? null,
                chassisNumber: values.chassisNumber ?? null,
                make: values.make ?? null,
                model: values.model ?? null,
                owner: ownerText(values.owner),
                errors: r.errors,
                scan: r.scanFileId ? { id: r.scanFileId, filename: scans.get(r.scanFileId) ?? '' } : null,
                vehicleId: r.vehicleId
            };
        });
    }

    /** A short link to a row's scan; the download is on record. */
    async scanLink(tx: Tx, store: ObjectStore, rowId: string): Promise<{ url: string; expiresAt: string }> {
        const [row] = await tx.select().from(vehicleImportRows).where(eq(vehicleImportRows.id, rowId));
        if (!row?.scanFileId) throw new NotFoundError();
        return downloadLinkedFile(tx, store, row.scanFileId, { table: IMPORTS_TABLE, id: row.importId });
    }

    /**
     * The second person commits a checked batch: never the one who sent it (SEC-AC-6), from its office or one above it (RLS: only
     * those see it). The worker then puts its valid rows on the register, with the rights the committer holds when it runs.
     */
    async commit(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        id: string,
        version: number,
        mayCommit: boolean
    ): Promise<VehicleImport> {
        const userId = required(ctx.userId);
        const [row] = await tx.select().from(vehicleImports).where(eq(vehicleImports.id, id)).for('update');
        if (!row) throw new NotFoundError();
        if (row.rowVersion !== version) throw new ConflictError('stale_version');
        if (row.createdBy === userId) throw new ForbiddenError({ detailKey: 'competency.errors.commit_own_import' });
        if (row.state !== 'checked')
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.import_not_checked' });
        const [valid] = await tx
            .select({ n: count() })
            .from(vehicleImportRows)
            .where(and(eq(vehicleImportRows.importId, id), eq(vehicleImportRows.state, 'valid')));
        if ((valid?.n ?? 0) === 0)
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.import_nothing_valid' });
        await updateAudited(tx, vehicleImports, id, row.rowVersion, {
            state: 'committing',
            committedBy: userId,
            commitUnitId: required(ctx.unitId),
            commitRoles: [...roles],
            committedAt: new Date()
        });
        await emit(tx, 'vehicle-import.commit-requested.v1', { importId: id });
        return this.get(tx, ctx, id, mayCommit);
    }

    /** A batch given up before its commit: its sheet is cleared; its rows stay, for the record. */
    async discard(tx: Tx, ctx: DbContext, id: string, version: number, mayCommit: boolean): Promise<VehicleImport> {
        const [row] = await tx.select().from(vehicleImports).where(eq(vehicleImports.id, id)).for('update');
        if (!row) throw new NotFoundError();
        if (row.rowVersion !== version) throw new ConflictError('stale_version');
        if (row.createdBy !== ctx.userId && !mayCommit) throw new ForbiddenError();
        if (row.state !== 'checked' && row.state !== 'failed')
            throw new ConflictError('invalid_transition', { detailKey: 'competency.errors.import_not_discardable' });
        await updateAudited(tx, vehicleImports, id, row.rowVersion, {
            state: 'discarded',
            failureCode: null,
            failureColumns: [],
            contentCt: null
        });
        return this.get(tx, ctx, id, mayCommit);
    }

    // ---- the worker: the dry run ----

    /**
     * Reads the sheet and checks every row (on `vehicle-import.check-requested.v1`), as its sender, with the roles they still hold.
     * Retried, it carries on with the rows it has not read; done, it does nothing.
     */
    async checkBatch(deps: ImportDeps, found: LoadedImport): Promise<'none' | 'failed' | 'checked'> {
        const { batch, ctx } = found;
        const importId = batch.id;
        if (!deps.permissionsOf(found.roles).has('vehicle-import:create')) {
            await deps.database.scoped(ctx, (tx) => this.fail(tx, importId, 'not_permitted'));
            return 'failed';
        }
        return runInContext(
            { requestId: ctx.requestId ?? importId, language: asLanguage(batch.language) },
            async () => {
                const content = await deps.database.scoped(ctx, async (tx) => {
                    const [row] = await tx.select().from(vehicleImports).where(eq(vehicleImports.id, importId));
                    if (row?.state !== 'checking' || !row.contentCt) return undefined;
                    return this.crypto.decrypt(tx, row.regionId, contentPlace(importId), row.contentCt);
                });
                if (content === undefined) return 'none';
                const sheet = await readSheet(batch.format, content);
                if (!sheet.ok) {
                    await deps.database.scoped(ctx, (tx) => this.fail(tx, importId, sheet.code, sheet.columns ?? []));
                    return 'failed';
                }
                const scans = await deps.database.scoped(ctx, (tx) => this.linkScans(tx, batch));
                const seen = await deps.database.scoped(ctx, (tx) => this.seenSoFar(tx, importId));
                const done = new Set(seen.lines);
                const todo = sheet.records.filter((r) => !done.has(r.line));
                for (let i = 0; i < todo.length; i += IMPORT_CHUNK) {
                    const chunk = todo.slice(i, i + IMPORT_CHUNK);
                    await deps.database.scoped(ctx, async (tx) => {
                        await tx.execute(sql`select pg_advisory_xact_lock(${IMPORT_LOCK}, hashtext(${importId}))`);
                        const [row] = await tx
                            .select({ state: vehicleImports.state })
                            .from(vehicleImports)
                            .where(eq(vehicleImports.id, importId));
                        if (row?.state !== 'checking') return;
                        // another delivery may have read some of these meanwhile
                        const read = new Set(
                            (
                                await tx
                                    .select({ line: vehicleImportRows.line })
                                    .from(vehicleImportRows)
                                    .where(
                                        and(
                                            eq(vehicleImportRows.importId, importId),
                                            inArray(
                                                vehicleImportRows.line,
                                                chunk.map((r) => r.line)
                                            )
                                        )
                                    )
                            ).map((r) => r.line)
                        );
                        const context = await this.context(tx);
                        // the rows stored so far, read under the lock: another delivery may have stored some since this one began
                        const { maps } = await this.seenSoFar(tx, importId);
                        for (const record of chunk) {
                            if (read.has(record.line)) continue;
                            const verdict = await this.judge(tx, batch, ctx, record, scans, maps, context);
                            await this.store(tx, batch, record.line, verdict);
                        }
                    });
                }
                await deps.database.scoped(ctx, async (tx) => {
                    const [row] = await tx
                        .select()
                        .from(vehicleImports)
                        .where(eq(vehicleImports.id, importId))
                        .for('update');
                    if (row?.state !== 'checking') return;
                    await updateAudited(tx, vehicleImports, importId, row.rowVersion, {
                        state: 'checked',
                        contentCt: null,
                        checkedAt: new Date()
                    });
                });
                return 'checked' as const;
            }
        );
    }

    private async fail(tx: Tx, importId: string, code: ImportFailure, columns: string[] = []): Promise<void> {
        const [row] = await tx.select().from(vehicleImports).where(eq(vehicleImports.id, importId)).for('update');
        if (row?.state !== 'checking') return;
        await updateAudited(tx, vehicleImports, importId, row.rowVersion, {
            state: 'failed',
            failureCode: code,
            failureColumns: columns,
            contentCt: null
        });
    }

    /**
     * The batch's scans linked to it, so they are kept; one that cannot be (expired meanwhile) is simply not there to match. Found
     * by their name folded, with or without its extension (the first scan sent of a name wins): name → file id.
     */
    private async linkScans(tx: Tx, batch: ImportRow): Promise<Map<string, string>> {
        // two deliveries at once link one after the other (the second finds them linked), so both hold every scan
        await tx.execute(sql`select pg_advisory_xact_lock(${IMPORT_LOCK}, hashtext(${batch.id}))`);
        const linked = new Map<string, string>();
        for (const id of batch.scanFileIds) {
            try {
                const file = await linkFile(tx, id, {
                    table: IMPORTS_TABLE,
                    id: batch.id,
                    documentType: SCAN_DOCUMENT
                });
                const name = scanKey(file.filename);
                for (const key of [name, name.replace(/\.[a-z0-9]+$/, '')]) if (!linked.has(key)) linked.set(key, id);
            } catch (error) {
                if (!(error instanceof AppError)) throw error;
            }
        }
        return linked;
    }

    /** What the rows already read hold: a retried dry run finds the second row of a file as the first run did. */
    private async seenSoFar(tx: Tx, importId: string): Promise<{ lines: number[]; maps: Seen }> {
        const rows = await tx
            .select()
            .from(vehicleImportRows)
            .where(eq(vehicleImportRows.importId, importId))
            .orderBy(asc(vehicleImportRows.line));
        const maps: Seen = {
            paper: new Map(),
            vin: new Map(),
            plate: new Map(),
            libre: new Map(),
            scan: new Map(),
            owner: new Map()
        };
        for (const row of rows) {
            const values = row.values as Partial<ImportValues> & { owner?: ImportOwner; ownerKey?: string };
            if (row.paperReference) setFirst(maps.paper, fold(row.paperReference), row.line);
            if (row.vinKey) setFirst(maps.vin, row.vinKey, row.line);
            if (row.plateKey) setFirst(maps.plate, row.plateKey, row.line);
            if (values.libreNumber) setFirst(maps.libre, fold(values.libreNumber), row.line);
            if (row.scanFileId) setFirst(maps.scan, row.scanFileId, row.line);
            if (row.ownerKey && values.owner?.kind === 'person')
                maps.owner.set(row.ownerKey.toString('hex'), ownerText(values.owner) ?? '');
        }
        return { lines: rows.map((r) => r.line), maps };
    }

    /** What every row of a chunk reads alike: the region's old plate codes and its vehicle categories by key and by name. */
    private async context(tx: Tx) {
        const legacy = await this.vehicles.legacyRegions(tx);
        const categories = new Map<string, string>();
        for (const c of await tx
            .select({ key: vehicleCategories.key, name: vehicleCategories.name, active: vehicleCategories.active })
            .from(vehicleCategories)) {
            if (!c.active) continue;
            categories.set(fold(c.key), c.key);
            for (const name of Object.values(c.name ?? {})) if (name) categories.set(fold(name), c.key);
        }
        return { legacy, categories };
    }

    /** One row of the dry run: its cells, then the sheet's other rows, then the register. Nothing is written but the row itself. */
    private async judge(
        tx: Tx,
        batch: ImportRow,
        ctx: DbContext,
        record: SheetRecord,
        scans: ReadonlyMap<string, string>,
        seen: Seen,
        context: Awaited<ReturnType<VehicleImportService['context']>>
    ): Promise<Verdict> {
        const read = readRow(record.cells);
        if (!read.ok) {
            if (read.paperReference) setFirst(seen.paper, fold(read.paperReference), record.line);
            return {
                state: 'invalid',
                errors: read.errors.map(cellError),
                paperReference: read.paperReference ?? null,
                values: partialValues(record.cells),
                sensitive: {}
            };
        }
        const { values, owner, sensitive } = read;
        const errors: CellError[] = [];
        const verdict: Verdict = {
            state: 'valid',
            errors: [],
            paperReference: values.paperReference,
            values: { ...values, owner },
            sensitive
        };
        const line = (n: number) => ({ line: String(n) });

        const categoryKey = context.categories.get(fold(values.category));
        if (!categoryKey) errors.push({ column: 'category', code: 'not_in_list' });

        // the scan: the file the row names, else the one named after its paper reference
        const scan = scans.get(scanKey(values.scanFile ?? values.paperReference));
        if (!scan) errors.push({ column: values.scanFile ? 'scan_file' : 'paper_reference', code: 'scan_missing' });
        else {
            const first = seen.scan.get(scan);
            if (first !== undefined) errors.push({ column: 'scan_file', code: 'scan_twice', params: line(first) });
            else verdict.scanFileId = scan;
        }

        // the sheet's other rows: one paper file, chassis, plate or libre in two rows
        const firstPaper = seen.paper.get(fold(values.paperReference));
        if (firstPaper !== undefined)
            errors.push({ column: 'paper_reference', code: 'duplicate_in_file', params: line(firstPaper) });
        const vin = parseVin(values.chassisNumber, {
            ...(values.chassisKind === 'iso3779' || values.chassisKind === 'other'
                ? { chassisKind: values.chassisKind }
                : {}),
            modelYear: values.modelYear,
            acceptMismatch: true
        });
        if (vin.ok) {
            verdict.vinKey = vin.vinKey;
            const first = seen.vin.get(vin.vinKey);
            if (first !== undefined)
                errors.push({ column: 'chassis_number', code: 'duplicate_in_file', params: line(first) });
        }
        const plate = parsePlate(values.plate, context.legacy);
        if (plate) {
            verdict.plateKey = plate.key;
            const first = seen.plate.get(plate.key);
            if (first !== undefined) errors.push({ column: 'plate', code: 'duplicate_in_file', params: line(first) });
        }
        if (values.libreNumber) {
            verdict.libreKey = fold(values.libreNumber);
            const first = seen.libre.get(verdict.libreKey);
            if (first !== undefined)
                errors.push({ column: 'libre_number', code: 'duplicate_in_file', params: line(first) });
        }
        // the same owner twice: one FIN given with two names
        const key = ownerKeyOf(owner, sensitive);
        if (key) {
            verdict.ownerKey = key;
            const name = seen.owner.get(this.ownerIndex(batch.regionId, key).toString('hex'));
            if (name !== undefined && name !== ownerText(owner))
                errors.push({ column: 'owner_fin', code: 'owner_differs' });
        }

        // the register: a file already imported is not an error, it is done
        if (vin.ok && errors.length === 0) {
            const [onRegister] = await tx
                .select({ id: vehicles.id, source: vehicles.migrationSource, reference: vehicles.paperReference })
                .from(vehicles)
                .where(and(eq(vehicles.regionId, batch.regionId), eq(vehicles.vinKey, vin.vinKey)));
            if (onRegister?.source === 'import' && fold(onRegister.reference ?? '') === fold(values.paperReference)) {
                this.remember(seen, verdict, record.line, ownerText(owner), batch.regionId);
                return { ...verdict, state: 'already_imported', vehicleId: onRegister.id };
            }
        }
        if (errors.length === 0 && categoryKey) {
            const ownerId = await this.ownerOnRegister(tx, batch.regionId, owner, sensitive, errors);
            if (errors.length === 0) {
                try {
                    await this.capture.check(
                        tx,
                        placeOf(batch, ctx),
                        captureInput(values, categoryKey, owner, ownerId),
                        {
                            ownersToBeMade: ownerId === undefined
                        }
                    );
                } catch (error) {
                    if (!(error instanceof AppError)) throw error;
                    verdict.errors = refusalErrors(error);
                }
            }
        }
        verdict.errors = [...errors.map(cellError), ...verdict.errors];
        // the first row of a file, chassis or plate is the one the others are measured against, valid or not
        this.remember(seen, verdict, record.line, ownerText(owner), batch.regionId);
        return verdict.errors.length > 0 ? { ...verdict, state: 'invalid' } : verdict;
    }

    /** The row as the first of its file, chassis, plate, libre, scan and owner, for the rows after it. */
    private remember(seen: Seen, verdict: Verdict, line: number, owner: string | null, regionId: string): void {
        if (verdict.paperReference) setFirst(seen.paper, fold(verdict.paperReference), line);
        if (verdict.vinKey) setFirst(seen.vin, verdict.vinKey, line);
        if (verdict.plateKey) setFirst(seen.plate, verdict.plateKey, line);
        if (verdict.libreKey) setFirst(seen.libre, verdict.libreKey, line);
        if (verdict.scanFileId) setFirst(seen.scan, verdict.scanFileId, line);
        if (verdict.ownerKey && owner !== null) {
            const hex = this.ownerIndex(regionId, verdict.ownerKey).toString('hex');
            if (!seen.owner.has(hex)) seen.owner.set(hex, owner);
        }
    }

    private ownerIndex(regionId: string, key: string): Buffer {
        return this.crypto.blindIndex(regionId, 'import_owner', key);
    }

    /**
     * The owner as the register has them, in the dry run: an organisation by its TIN (it must be there), a person by their FIN.
     * A person to be made who may be someone on the register already (the same name with the same phone) is an error for a person
     * to resolve. Undefined when the commit will make the person.
     */
    private async ownerOnRegister(
        tx: Tx,
        regionId: string,
        owner: ImportOwner,
        sensitive: ImportSensitive,
        errors: CellError[]
    ): Promise<string | undefined> {
        if (owner.kind === 'organisation') {
            const [found] = await tx
                .select({ id: organisations.id })
                .from(organisations)
                .where(and(eq(organisations.regionId, regionId), eq(organisations.tin, owner.tin)));
            if (!found) errors.push({ column: 'owner_tin', code: 'owner_not_found' });
            return found?.id;
        }
        if (sensitive.fin) {
            const [holder] = (await this.persons.lookup(tx, regionId, { fin: sensitive.fin })).filter(
                (p) => p.status === 'active'
            );
            if (holder) return holder.id;
        }
        const duplicates = await this.persons.duplicates(tx, regionId, {
            nameAm: owner.nameAm,
            ...(owner.nameEn ? { nameEn: owner.nameEn } : {}),
            sensitive: {
                ...(sensitive.phone ? { phone: sensitive.phone } : {}),
                ...(sensitive.fin ? { fin: sensitive.fin } : {})
            }
        });
        if (duplicates.items.length > 0) errors.push({ column: 'owner_name_am', code: 'owner_possible_duplicate' });
        return undefined;
    }

    private async store(tx: Tx, batch: ImportRow, line: number, verdict: Verdict): Promise<void> {
        const id = newId();
        const hasSensitive = Boolean(verdict.sensitive.phone || verdict.sensitive.fin);
        await insertAudited(tx, vehicleImportRows, {
            id,
            regionId: batch.regionId,
            handlingUnitId: batch.handlingUnitId,
            importId: batch.id,
            line,
            state: verdict.state,
            paperReference: verdict.paperReference,
            values: verdict.values,
            sensitiveCt: hasSensitive
                ? await this.crypto.encrypt(tx, batch.regionId, sensitivePlace(id), JSON.stringify(verdict.sensitive))
                : null,
            errors: verdict.errors,
            vinKey: verdict.vinKey ?? null,
            plateKey: verdict.plateKey ?? null,
            ownerKey: verdict.ownerKey ? this.ownerIndex(batch.regionId, verdict.ownerKey) : null,
            scanFileId: verdict.scanFileId ?? null,
            vehicleId: verdict.vehicleId ?? null
        });
    }

    // ---- the worker: the commit ----

    /**
     * Puts the batch's valid rows on the register (on `vehicle-import.commit-requested.v1`), as the person who committed it, each
     * row in its own transaction: a row the register now refuses (a chassis captured meanwhile) is reported with its errors and the
     * others go on. Retried, it carries on with the rows still valid.
     */
    async commitBatch(deps: ImportDeps, found: LoadedImport): Promise<'committed' | 'refused'> {
        const { batch, ctx } = found;
        const importId = batch.id;
        const committer = batch.committedBy ?? '';
        if (!deps.permissionsOf(found.roles).has('vehicle-import:commit')) {
            // the right was taken away since: the batch waits for someone who holds it
            await deps.database.scoped(ctx, async (tx) => {
                const [row] = await tx
                    .select()
                    .from(vehicleImports)
                    .where(eq(vehicleImports.id, importId))
                    .for('update');
                if (row?.state !== 'committing') return;
                await updateAudited(tx, vehicleImports, importId, row.rowVersion, {
                    state: 'checked',
                    committedBy: null,
                    commitUnitId: null,
                    commitRoles: null,
                    committedAt: null
                });
            });
            return 'refused';
        }
        return runInContext(
            { requestId: ctx.requestId ?? importId, language: asLanguage(batch.language) },
            async () => {
                const valid = await deps.database.scoped(ctx, (tx) =>
                    tx
                        .select({ id: vehicleImportRows.id })
                        .from(vehicleImportRows)
                        .where(and(eq(vehicleImportRows.importId, importId), eq(vehicleImportRows.state, 'valid')))
                        .orderBy(asc(vehicleImportRows.line))
                );
                for (const { id } of valid) {
                    try {
                        await deps.database.scoped(ctx, (tx) => this.commitRow(tx, batch, ctx, committer, id));
                    } catch (error) {
                        // the register refuses it now: the row says why, the others go on; anything else is retried
                        if (!(error instanceof AppError)) throw error;
                        await deps.database.scoped(ctx, async (tx) => {
                            const [row] = await tx
                                .select()
                                .from(vehicleImportRows)
                                .where(eq(vehicleImportRows.id, id))
                                .for('update');
                            if (row?.state !== 'valid') return;
                            await updateAudited(tx, vehicleImportRows, id, row.rowVersion, {
                                state: 'invalid',
                                errors: refusalErrors(error)
                            });
                        });
                    }
                }
                await deps.database.scoped(ctx, async (tx) => {
                    const [row] = await tx
                        .select()
                        .from(vehicleImports)
                        .where(eq(vehicleImports.id, importId))
                        .for('update');
                    if (row?.state !== 'committing') return;
                    await updateAudited(tx, vehicleImports, importId, row.rowVersion, { state: 'committed' });
                });
                return 'committed' as const;
            }
        );
    }

    /** One valid row: its owner found or made, the register's rules checked again, and the vehicle put on the register. */
    private async commitRow(tx: Tx, batch: ImportRow, ctx: DbContext, committer: string, rowId: string): Promise<void> {
        const [row] = await tx.select().from(vehicleImportRows).where(eq(vehicleImportRows.id, rowId)).for('update');
        if (row?.state !== 'valid') return;
        const { owner, ...values } = row.values as ImportValues & { owner: ImportOwner };
        const sensitive: ImportSensitive = row.sensitiveCt
            ? (JSON.parse(
                  await this.crypto.decrypt(tx, batch.regionId, sensitivePlace(row.id), row.sensitiveCt)
              ) as ImportSensitive)
            : {};
        const place = placeOf(batch, ctx);
        const categoryKey = (await this.context(tx)).categories.get(fold(values.category)) ?? values.category;
        const ownerId = await this.ownerForCommit(tx, place, row, owner, sensitive);
        const input = captureInput(values, categoryKey, owner, ownerId);
        await this.capture.check(tx, place, input);
        const made = await this.capture.importRow(tx, place, input, { id: row.id, committedBy: committer });
        await updateAudited(tx, vehicleImportRows, row.id, row.rowVersion, {
            state: 'imported',
            vehicleId: made.vehicle.id,
            ownerPersonId: owner.kind === 'person' ? ownerId : null
        });
    }

    /** The owner at the commit: the organisation by its TIN; the person an earlier row of the batch made, found by FIN, or made. */
    private async ownerForCommit(
        tx: Tx,
        place: CapturePlace,
        row: RowRecord,
        owner: ImportOwner,
        sensitive: ImportSensitive
    ): Promise<string> {
        if (owner.kind === 'organisation') {
            const [found] = await tx
                .select({ id: organisations.id })
                .from(organisations)
                .where(and(eq(organisations.regionId, place.regionId), eq(organisations.tin, owner.tin)));
            if (!found)
                throw new ValidationError('validation_failed', {
                    errors: [
                        {
                            path: 'owners',
                            code: 'owner_not_found',
                            message: say('competency.import.error.owner_not_found')
                        }
                    ]
                });
            return found.id;
        }
        if (row.ownerKey) {
            const [earlier] = await tx
                .select({ personId: vehicleImportRows.ownerPersonId })
                .from(vehicleImportRows)
                .where(
                    and(
                        eq(vehicleImportRows.importId, row.importId),
                        eq(vehicleImportRows.ownerKey, row.ownerKey),
                        isNotNull(vehicleImportRows.ownerPersonId)
                    )
                )
                .limit(1);
            if (earlier?.personId) return earlier.personId;
        }
        if (sensitive.fin) {
            const [holder] = (await this.persons.lookup(tx, place.regionId, { fin: sensitive.fin })).filter(
                (p) => p.status === 'active'
            );
            if (holder) return holder.id;
        }
        const made = await this.persons.create(
            tx,
            { ...place.ctx, unitId: place.handlingUnitId },
            {
                nameAm: owner.nameAm,
                ...(owner.nameEn ? { nameEn: owner.nameEn } : {}),
                sex: owner.sex,
                ...(sensitive.phone || sensitive.fin
                    ? {
                          sensitive: {
                              ...(sensitive.phone ? { phone: sensitive.phone } : {}),
                              ...(sensitive.fin ? { fin: sensitive.fin } : {})
                          }
                      }
                    : {}),
                acknowledgedDuplicates: []
            }
        );
        return made.id;
    }
}

/**
 * The capture's place for a row: the importing office, and the person acting (the sender in the dry run, the committer at the
 * commit, who may act from an office above it).
 */
function placeOf(batch: ImportRow, ctx: DbContext): CapturePlace {
    return { caseId: null, regionId: batch.regionId, handlingUnitId: batch.handlingUnitId, ctx };
}

/** The capture's answers as MIG-01 takes them, with the owner the check or the commit found (or the placeholder of one to make). */
function captureInput(
    values: ImportValues,
    categoryKey: string,
    owner: ImportOwner,
    ownerId: string | undefined
): BackCaptureInput {
    const { category: _category, scanFile: _scan, ...rest } = values;
    void _category;
    void _scan;
    const id = ownerId ?? PLACEHOLDER_ID;
    return {
        ...rest,
        categoryKey,
        owners: [owner.kind === 'person' ? { ownerPerson: id } : { ownerOrganisation: id }]
    };
}

/** What an invalid row still shows in the report: the facts its cells give, as typed. */
function partialValues(cells: Readonly<Record<string, string>>): Record<string, unknown> {
    const pick = (key: string) => cells[key]?.slice(0, 60);
    return {
        ...(pick('plate') ? { plate: pick('plate') } : {}),
        ...(pick('chassis_number') ? { chassisNumber: pick('chassis_number') } : {}),
        ...(pick('make') ? { make: pick('make') } : {}),
        ...(pick('model') ? { model: pick('model') } : {})
    };
}

function setFirst<K>(map: Map<K, number>, key: K, line: number): void {
    if (!map.has(key)) map.set(key, line);
}

/** The owner as the report names them: a person's Amharic name, an organisation's TIN. */
function ownerText(owner: ImportOwner | undefined): string | null {
    if (!owner) return null;
    if (owner.kind === 'organisation') return owner.tin;
    const { given, father, grandfather } = owner.nameAm;
    return [given, father, grandfather].filter(Boolean).join(' ');
}

const asLanguage = (value: string): Language => (value === 'en' || value === 'wal-Latn' ? value : 'am');

function say(key: string): string {
    return words(languageNow(), key) ?? key;
}

function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError({ detailKey: 'vehicles.errors.choose_office' });
    return value;
}
