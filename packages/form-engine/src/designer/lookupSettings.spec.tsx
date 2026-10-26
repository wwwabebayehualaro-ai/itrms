import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '../renderer/fields/registerAll';
import { getFieldType } from '../renderer/kit';
import { amText, hostRenderer } from '../test-utils';
import { SettingsForm } from './SettingsForm';

const providers = [
    { key: 'person', title: 'Persons', facts: [] },
    { key: 'organisation', title: 'Organisations', facts: [] }
];

describe('the settings of a registry lookup (task 0.18)', () => {
    it('offers the registries the host serves as a select and stores the key of the chosen one', async () => {
        const get = vi.fn().mockResolvedValue({ data: { items: providers }, status: 200, headers: {} });
        const onChange = vi.fn();
        hostRenderer({ client: { get } })(
            <SettingsForm
                schema={getFieldType('RegistryLookup')?.design?.settings}
                value={() => undefined}
                own={() => true}
                onChange={onChange}
                idPrefix="t"
            />
        );
        expect(screen.getByText(amText('form-engine.settings.RegistryLookup.provider.title'))).toBeTruthy();
        await userEvent.click(
            screen.getByRole('combobox', { name: amText('form-engine.settings.RegistryLookup.provider.title') })
        );
        await userEvent.click(await screen.findByRole('option', { name: 'Organisations' }));
        expect(get).toHaveBeenCalledWith('v1/registry-lookups', expect.anything());
        await waitFor(() => expect(onChange).toHaveBeenCalledWith('provider', 'organisation'));
    });

    it('offers the document types of a file field by their names', async () => {
        hostRenderer({})(
            <SettingsForm
                schema={getFieldType('FileUpload')?.design?.settings}
                value={() => undefined}
                own={() => true}
                onChange={() => {}}
                idPrefix="t"
            />
        );
        await userEvent.click(
            screen.getByRole('combobox', { name: amText('form-engine.settings.FileUpload.docType.title') })
        );
        expect(
            await screen.findByRole('option', { name: amText('form-engine.core.documentType.medical_certificate') })
        ).toBeTruthy();
    });
});
