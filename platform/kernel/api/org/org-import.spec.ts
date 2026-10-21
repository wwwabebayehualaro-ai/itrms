import { describe, expect, it } from 'vitest';

import { expandServiceCodes, parseCsv, parseOrgCsv, parseOrgYaml } from './org-import';

describe('the org import parsers', () => {
    it('expand service-code ranges', () => {
        expect(expandServiceCodes(['RS-01..03', 'PT-04', 'DVC-09..DVC-11'])).toEqual([
            'RS-01',
            'RS-02',
            'RS-03',
            'PT-04',
            'DVC-09',
            'DVC-10',
            'DVC-11'
        ]);
        expect(() => expandServiceCodes(['RS-07..01'])).toThrow(/ends before it starts/);
        expect(() => expandServiceCodes(['licences'])).toThrow(/not a service code/);
    });

    it('read RFC 4180 CSV: quotes, commas and line breaks in fields, a BOM, CRLF', () => {
        expect(parseCsv('﻿a,b\r\n"x, ""y""","line\nbreak"\r\n\r\n')).toEqual([
            ['a', 'b'],
            ['x, "y"', 'line\nbreak']
        ]);
    });

    it('turn CSV rows into units, names by language tag', () => {
        const doc = parseOrgCsv(
            'code,kind,level,name_am,name_en,name_wal-latn,to_confirm\nW1,woreda,woreda,ወ,W,W,name.am|category',
            'SER'
        );
        expect(doc.units[0]).toMatchObject({
            code: 'W1',
            name: { am: 'ወ', en: 'W', 'wal-Latn': 'W' },
            toConfirm: ['name.am', 'category']
        });
    });

    it('refuse a document with every problem and where it is', () => {
        expect(() =>
            parseOrgYaml('region: { code: SER }\nunits:\n  - { code: "bad code", kind: planet, level: x }')
        ).toThrow(
            expect.objectContaining({
                status: 422,
                errors: expect.arrayContaining([
                    expect.objectContaining({ path: 'units.0.code' }),
                    expect.objectContaining({ path: 'units.0.kind' }),
                    expect.objectContaining({ path: 'units.0.name' })
                ]) as unknown
            })
        );
    });

    it('ignore x- keys (anchors) at the top of a YAML file', () => {
        const doc = parseOrgYaml('x-names:\n  a: &a { am: ሀ, en: A }\nregion: { code: SER, name: *a }');
        expect(doc.region.name).toEqual({ am: 'ሀ', en: 'A' });
    });
});
