/**
 * The browser's copy of a person's drafts (task 0.20c, ADR-0024 with SEC-WB-3): Dexie (IndexedDB), each draft sealed with
 * the person's own key (seal.ts) and holding only the answers that are not Sensitive (the caller strips them with the
 * engine's `withoutSensitive`). A draft saved here survives a dropped network and a reload; it is synced to the server
 * when the link is back. Forgetting a person deletes their key and their drafts.
 */
import Dexie, { type Table } from 'dexie';

import { newSealKey, seal, unseal, type Sealed } from './seal';

interface KeyRow {
    userId: string;
    key: CryptoKey;
}

/** A draft as kept here: what it is, when it changed, whether the server has this change; the answers sealed. */
export interface LocalDraftMeta {
    /** this copy's id: the server draft's id once it has one, else one made here */
    localId: string;
    userId: string;
    formId: string;
    /** the server's draft, once saved there */
    draftId: string | null;
    formVersionId: string;
    /** when it last changed here (ms) */
    updatedAt: number;
    /** the server has this change */
    synced: boolean;
}

interface DraftRow extends LocalDraftMeta, Sealed {}

class DraftsDb extends Dexie {
    keys!: Table<KeyRow, string>;
    drafts!: Table<DraftRow, string>;

    constructor() {
        super('itrms-drafts');
        this.version(1).stores({ keys: '&userId', drafts: '&localId, userId, [userId+formId]' });
    }
}

let db: DraftsDb | null = null;
const open = () => (db ??= new DraftsDb());

async function keyOf(userId: string): Promise<CryptoKey> {
    const found = await open().keys.get(userId);
    if (found) return found.key;
    const key = await newSealKey();
    await open().keys.put({ userId, key });
    return key;
}

/** Keeps a draft here: its answers (already without the Sensitive ones) sealed with the person's key. */
export async function saveLocal(meta: LocalDraftMeta, answers: Record<string, unknown>): Promise<void> {
    const sealed = await seal(await keyOf(meta.userId), answers);
    await open().drafts.put({ ...meta, ...sealed });
}

/** A draft kept here, with its answers; null when there is none, or it can no longer be read (its key is gone). */
export async function loadLocal(
    userId: string,
    localId: string
): Promise<(LocalDraftMeta & { answers: Record<string, unknown> }) | null> {
    const row = await open().drafts.get(localId);
    if (!row || row.userId !== userId) return null;
    const key = await open().keys.get(userId);
    if (!key) return null;
    try {
        const answers = (await unseal(key.key, row)) as Record<string, unknown>;
        const { iv: _iv, data: _data, ...meta } = row;
        return { ...meta, answers };
    } catch (error) {
        // sealed with another key (one since deleted): unreadable by design (SEC-WB-3)
        if (error instanceof DOMException && error.name === 'OperationError') return null;
        throw error;
    }
}

/** What a person keeps here, the latest first, without the answers. */
export async function listLocal(userId: string): Promise<LocalDraftMeta[]> {
    const rows = await open().drafts.where('userId').equals(userId).toArray();
    return rows.map(({ iv: _iv, data: _data, ...meta }) => meta).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Moves a draft kept here under its server id, once the server has it. */
export async function renameLocal(fromId: string, toId: string, draftId: string): Promise<void> {
    await open().transaction('rw', open().drafts, async () => {
        const row = await open().drafts.get(fromId);
        if (!row) return;
        await open().drafts.delete(fromId);
        await open().drafts.put({ ...row, localId: toId, draftId });
    });
}

export async function markSynced(localId: string, updatedAt: number): Promise<void> {
    // only when nothing changed here since that save
    await open()
        .drafts.where('localId')
        .equals(localId)
        .modify((row) => {
            if (row.updatedAt <= updatedAt) row.synced = true;
        });
}

export async function removeLocal(localId: string): Promise<void> {
    await open().drafts.delete(localId);
}

/** The person's drafts the server does not have yet (a sign-out would lose them). */
export async function unsyncedCount(userId: string): Promise<number> {
    return (await listLocal(userId)).filter((d) => !d.synced).length;
}

/** Deletes a person's key and drafts: what was kept for them here is gone (an explicit sign-out). */
export async function forget(userId: string): Promise<void> {
    await open().transaction('rw', open().keys, open().drafts, async () => {
        await open().drafts.where('userId').equals(userId).delete();
        await open().keys.delete(userId);
    });
}
