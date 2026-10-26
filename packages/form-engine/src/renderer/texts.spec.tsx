import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({ ...(await original<typeof UI>()), useNotify: () => notify }));

import { EngineForm } from './EngineForm';
import { hostRenderer } from '../test-utils';

const L = (am: string, en: string) => ({ am, en });
const field = (type: string, id: string, label: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label,
    category: 'Input',
    props: {},
    data: { defaultProps: {} },
    behavior: { validation: { supported: true } },
    layout: { options: { isContainer: false } },
    ...extra
});
const container = (type: string, id: string, props: Record<string, unknown>) =>
    field(type, id, id, {
        category: 'Layout',
        props,
        layout: { options: { isContainer: true } }
    });

const fields = [
    container('Panel', 'box', { header: L('የግል ክፍል', 'Personal part') }),
    { ...field('InputText', 'name', 'Name'), parentId: 'box' },
    container('FormArray', 'rows', {
        itemLabel: L('ዕቃ', 'Thing'),
        addButtonLabel: L('ረድፍ ጨምር', 'Add a thing'),
        emptyMessage: L('ምንም የለም', 'Nothing yet'),
        minItems: 0
    }),
    { ...field('InputText', 'what', 'What'), parentId: 'rows' },
    field('FileUpload', 'docs', 'Documents', { props: { chooseLabel: L('ፋይል ምረጥ', 'Pick a file') } })
];

function show(language: string) {
    const renderWithQuery = hostRenderer({ language, languages: ['am', 'en'] });
    renderWithQuery(
        <EngineForm
            fields={fields}
            template={{ id: 'tpl-1', name: 'Sample', form_config: { fields } } as never}
            onFormSubmit={() => Promise.resolve()}
            submissionId="s1"
        />
    );
}

describe('the form texts in the reader’s language (task 0.17c)', () => {
    it('shows the Amharic texts', () => {
        show('am');
        expect(screen.getByText('የግል ክፍል')).toBeTruthy();
        expect(screen.getByText('ረድፍ ጨምር')).toBeTruthy();
        expect(screen.getByText('ምንም የለም')).toBeTruthy();
        expect(screen.getByText('ፋይል ምረጥ')).toBeTruthy();
    });

    it('shows the English texts', () => {
        show('en');
        expect(screen.getByText('Personal part')).toBeTruthy();
        expect(screen.getByText('Add a thing')).toBeTruthy();
        expect(screen.getByText('Nothing yet')).toBeTruthy();
        expect(screen.getByText('Pick a file')).toBeTruthy();
    });
});
