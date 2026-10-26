import { useMemo } from 'react';

import type { DataGridLabels, PagerLabels } from '@itrms/ui';

import { useEngineText } from '../host/text';

/** The design system's grid and pager words in the screen's language (`packages/ui` has no catalogue of its own). */
export function useGridLabels(): { grid: DataGridLabels; pager: PagerLabels } {
    const { t } = useEngineText();
    return useMemo(() => {
        // the ui fills these placeholders itself, so they reach it as written
        const raw = (name: string) => `{${name}}`;
        const pager: PagerLabels = {
            pages: t('form-engine.viewer.pager.pages'),
            none: t('form-engine.viewer.pager.none', { noun: raw('noun') }),
            range: t('form-engine.viewer.pager.range', { from: raw('from'), to: raw('to'), total: raw('total') }),
            records: t('form-engine.viewer.pager.records'),
            rowsPerPage: t('form-engine.viewer.pager.rowsPerPage'),
            perPage: t('form-engine.viewer.pager.perPage', { size: raw('size') }),
            first: t('form-engine.viewer.pager.first'),
            previous: t('form-engine.viewer.pager.previous'),
            next: t('form-engine.viewer.pager.next'),
            last: t('form-engine.viewer.pager.last'),
            pageOf: t('form-engine.viewer.pager.pageOf', { page: raw('page'), pages: raw('pages') })
        };
        const grid: DataGridLabels = {
            selectAll: t('form-engine.viewer.grid.selectAll'),
            selectRow: t('form-engine.viewer.grid.selectRow', { row: raw('row') }),
            selected: t('form-engine.viewer.grid.selected', { count: raw('count') }),
            clearSelection: t('form-engine.viewer.grid.clearSelection'),
            resizeColumn: t('form-engine.viewer.grid.resizeColumn', { column: raw('column') }),
            pager
        };
        return { grid, pager };
    }, [t]);
}
