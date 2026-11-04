'use client';

/**
 * A case's documents on its page (task 0.23a): what was issued, how far its PDF has got, and the PDF itself, which is the stored
 * one each time. Nothing shows to someone without the right, or on a case with none.
 */
import { Button, StatusBadge, useNotify, type Tone } from '@itrms/ui';

import { getApiErrorMessage } from '@/lib/api/errors';
import { useCan } from '@/lib/auth/authHooks';
import { documentLink, isBeingMade, useIssuedDocuments, type IssuedDocumentOut } from '@/lib/documents';
import { formatMoment } from '@/lib/format';
import { usePreferences, useText } from '@/lib/preferences';

const TONE: Record<IssuedDocumentOut['state'], Tone> = { requested: 'progress', rendered: 'success', failed: 'danger' };

/** Downloads a document's stored PDF: the store serves it as an attachment, so this page stays where it is. */
export function OpenPdfButton({ document, label }: { document: IssuedDocumentOut; label: string }) {
    const notify = useNotify();
    return (
        <Button
            size="sm"
            variant="outline"
            data-action="open-pdf"
            onClick={() => {
                void documentLink(document.id)
                    .then((url) => {
                        window.location.href = url;
                    })
                    .catch((error: unknown) => notify.error(getApiErrorMessage(error)));
            }}
        >
            {label}
        </Button>
    );
}

export function CaseDocuments({ caseId }: { caseId: string }) {
    const { t, text, language } = useText();
    const calendar = usePreferences((s) => s.calendar);
    const documents = useIssuedDocuments({ caseId }, useCan('issued-document:read'));
    const items = documents.data?.items ?? [];
    if (items.length === 0) return null;
    return (
        <section className="flex flex-col gap-2 rounded-md border p-4" data-case-documents>
            <h2 className="font-medium">{t('documents.case.title')}</h2>
            <ul className="flex flex-col gap-2">
                {items.map((d) => (
                    <li
                        key={d.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                        data-document={d.templateKey}
                        data-state={d.state}
                    >
                        <span>
                            {text(d.templateName)}
                            {d.number && ` · ${d.number}`}
                            <span className="text-muted-foreground">
                                {' '}
                                · {formatMoment(d.issuedAt, { language, calendar })}
                            </span>
                        </span>
                        <span className="flex items-center gap-2">
                            {d.state === 'rendered' ? (
                                <OpenPdfButton document={d} label={t('documents.case.download')} />
                            ) : (
                                <StatusBadge
                                    value={d.state}
                                    tone={TONE[d.state]}
                                    label={t(
                                        d.state === 'requested' && !isBeingMade(d)
                                            ? 'documents.state.late'
                                            : `documents.state.${d.state}`
                                    )}
                                />
                            )}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
