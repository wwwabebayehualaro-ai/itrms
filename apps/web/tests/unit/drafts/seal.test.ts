// @vitest-environment node
/**
 * Sealing a draft for the browser's storage (task 0.20c, SEC-WB-3): what is stored reads back only with its person's
 * key, the key's bytes cannot be taken out, and each seal is different (its own IV) for the same answers.
 */
import { describe, expect, it } from 'vitest';

import { newSealKey, seal, unseal } from '@/lib/drafts/seal';

describe('a sealed draft', () => {
    it('reads back with its key, and with no other', async () => {
        const key = await newSealKey();
        const answers = { name: 'Abebe', town: 'Boditi', rows: [{ a: 1 }] };
        const sealed = await seal(key, answers);
        expect(new TextDecoder().decode(sealed.data)).not.toContain('Abebe');
        expect(await unseal(key, sealed)).toEqual(answers);
        await expect(unseal(await newSealKey(), sealed)).rejects.toMatchObject({ name: 'OperationError' });
    });

    it('is sealed with a key whose bytes cannot be exported, and anew each time', async () => {
        const key = await newSealKey();
        expect(key.extractable).toBe(false);
        await expect(crypto.subtle.exportKey('raw', key)).rejects.toBeDefined();
        const [a, b] = [await seal(key, { x: 1 }), await seal(key, { x: 1 })];
        expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(false);
    });

    it('cannot be changed unseen (the cipher authenticates it)', async () => {
        const key = await newSealKey();
        const sealed = await seal(key, { x: 1 });
        const bytes = new Uint8Array(sealed.data);
        bytes[0] = (bytes[0] ?? 0) ^ 0xff;
        await expect(unseal(key, { iv: sealed.iv, data: bytes.buffer })).rejects.toMatchObject({
            name: 'OperationError'
        });
    });
});
