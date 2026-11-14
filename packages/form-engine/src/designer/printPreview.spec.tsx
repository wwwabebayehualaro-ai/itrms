/**
 * The builder's print preview (task 1.13e): the form as it prints, with the values entered, under the acting office's header as
 * the documents API gives it; the body is the PDF's own `PrintForm`, so the printed fields are the same.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PrintForm } from '../print/PrintForm';
import { hostRenderer } from '../test-utils';
import type { StoredDocument } from './document';
import { PrintPreview } from './PrintPreview';

const client = { get: vi.fn(), post: vi.fn(), request: vi.fn() };
const render = hostRenderer({
    language: 'en',
    client,
    user: { id: 'u1', email: 'maker@example.org', full_name: 'Maker', roles: [], tenant_id: 't1', permissions: [] }
});

const stored = {
    schemaVersion: 2,
    fields: [
        {
            id: 'fullName',
            type: 'InputText',
            label: { am: 'ሙሉ ስም', en: 'Full name' },
            category: 'Input',
            classification: 'personal',
            props: {},
            data: { defaultProps: {} },
            behavior: { validation: { supported: true } },
            layout: { options: { isContainer: false } }
        }
    ],
    runtime: { dataSources: [], actions: [] }
} as unknown as StoredDocument;

describe('the print preview', () => {
    it("heads the printed form with the office's header and shows the values entered, as the PDF prints them", async () => {
        client.get.mockResolvedValueOnce({
            data: {
                title: { am: 'የናሙና ዞን መምሪያ', en: 'Sample Zone Department' },
                subtitle: { am: 'የትራንስፖርት ዘርፍ', en: 'Transport sector' },
                logo: null,
                stamp: null
            }
        });
        const values = { fullName: 'Sample Applicant' };
        const { container } = render(
            <PrintPreview stored={stored} values={values} language="en" title="Sample form" />
        );
        expect(await screen.findByText('Sample Zone Department')).toBeInTheDocument();
        expect(screen.getByText('Transport sector')).toBeInTheDocument();
        expect(client.get).toHaveBeenCalledWith('v1/document-header', expect.anything());
        // the body is the PDF's: the same markup PrintForm gives the documents
        const body = container.querySelector('[data-print-preview] article.fe-print');
        expect(body?.outerHTML).toBe(
            renderToStaticMarkup(<PrintForm form={stored} values={values} language="en" title="Sample form" />)
        );
        expect(body).toHaveTextContent('Sample Applicant');
    });

    it('prints without a header, and says so, when the header cannot be read', async () => {
        client.get.mockRejectedValueOnce(new Error('forbidden'));
        render(<PrintPreview stored={stored} values={{}} language="en" />);
        await waitFor(() =>
            expect(
                screen.getByText('Your office’s header could not be read: the form prints without it here.')
            ).toBeInTheDocument()
        );
        expect(document.querySelector('[data-print-preview] article.fe-print')).not.toBeNull();
    });
});
