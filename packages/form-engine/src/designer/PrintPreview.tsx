'use client';

/**
 * The builder's print preview (task 1.13e, form-platform.md §6): the form as it prints, with the values entered in the preview,
 * under the acting office's official header as its documents print it (logo, title, subtitle: `GET document-header`). The body is
 * the PDF's own: `PrintForm` on the same print model and stylesheet the documents use, so what the author sees is what prints.
 */
import { useQuery } from '@tanstack/react-query';
import { Card } from '@itrms/ui';
import { formTextIn, type I18nText } from '@itrms/schemas';

import { FORMS_API } from '../api/wire';
import { useFormsClient } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import { PrintForm } from '../print/PrintForm';
import type { StoredDocument } from './document';

/** The acting office's header, as the documents API gives it. */
export interface OfficialHeader {
    title: I18nText;
    subtitle: I18nText | null;
    logo: string | null;
    stamp: string | null;
}

export function useOfficialHeader() {
    const client = useFormsClient();
    return useQuery({
        queryKey: ['document-header'] as const,
        queryFn: async ({ signal }) => (await client.get<OfficialHeader>(FORMS_API.documentHeader, { signal })).data,
        staleTime: 5 * 60_000,
        meta: { silent: true }
    });
}

export function PrintPreview({
    stored,
    values,
    language,
    title
}: {
    stored: StoredDocument;
    values: Record<string, unknown>;
    language: string;
    title?: string;
}) {
    const { t } = useEngineText();
    const { data: header, isError } = useOfficialHeader();
    const headerTitle = header ? formTextIn(header.title, language) : undefined;
    const subtitle = header?.subtitle ? formTextIn(header.subtitle, language) : undefined;
    return (
        <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">{t('form-engine.designer.print.intro')}</p>
            {isError && <p className="text-sm text-muted-foreground">{t('form-engine.designer.print.noHeader')}</p>}
            {/* paper: white with black text in every theme, as it prints */}
            <Card className="mx-auto w-full max-w-4xl gap-0 bg-white p-8 text-black" data-print-preview>
                <header className="mb-4 flex items-center gap-4 border-b border-black/20 pb-3" data-print-header>
                    {header?.logo && <img src={header.logo} alt="" className="size-16 object-contain" />}
                    <div>
                        {headerTitle && <p className="text-lg font-bold">{headerTitle}</p>}
                        {subtitle && <p className="text-base">{subtitle}</p>}
                    </div>
                </header>
                <PrintForm form={stored} values={values} language={language} title={title} />
            </Card>
        </div>
    );
}
