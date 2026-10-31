/**
 * What a caller may see of a form (G1, task 0.21e follow-up): a field restricted to other roles goes, and so does
 * everything inside a restricted container, at any depth; nothing else does.
 */
import { describe, expect, it } from 'vitest';

import { fieldsForRoles, readDocument } from './';

const field = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    category: 'Input',
    label: id,
    props: {},
    ...extra
});
const panel = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'Panel',
    category: 'Layout',
    label: id,
    props: {},
    layout: { options: { isContainer: true } },
    ...extra
});

const { fields } = readDocument({
    fields: [
        field('plate'),
        field('note', { visibleToRoles: ['records_officer'] }),
        panel('office', { visibleToRoles: ['records_officer'] }),
        field('receivedBy', { parentId: 'office' }),
        panel('inner', { parentId: 'office' }),
        field('stamp', { parentId: 'inner' }),
        panel('open'),
        field('remark', { parentId: 'open' })
    ]
});
const ids = (roles: string[]) => fieldsForRoles(fields, roles).map((f) => f.id);

describe('fieldsForRoles', () => {
    it('drops a restricted field and everything inside a restricted container, at any depth', () => {
        expect(ids(['unit_head'])).toEqual(['plate', 'open', 'remark']);
    });

    it('keeps them all for the role they are restricted to', () => {
        expect(ids(['records_officer'])).toEqual([
            'plate',
            'note',
            'office',
            'receivedBy',
            'inner',
            'stamp',
            'open',
            'remark'
        ]);
    });
});
