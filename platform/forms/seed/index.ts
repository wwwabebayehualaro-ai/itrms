/**
 * The starter blocks (task 1.13d, form-platform.md §6): the groups of fields most request forms ask for, published at the region's
 * root as blocks a form author copies into a form. They are generated, not copied from a bureau's paper: a bureau changes them, or
 * makes its own, in the builder. Like the services' seeds it only ever makes a first version and leaves a published block alone.
 */
import { and, eq } from 'drizzle-orm';
import { contentHash, insertAudited, type Tx, updateAudited } from '@itrms/kernel/db';

import { formDefinitions, formVersions } from '../api/forms.table';

type Text = { am: string; en: string };
const text = (am: string, en: string): Text => ({ am, en });

const value = (
    id: string,
    type: string,
    label: Text,
    props: Record<string, unknown> = {},
    extra: Record<string, unknown> = {}
) => ({
    id,
    type,
    label,
    category: 'Input',
    classification: 'personal',
    props,
    data: { defaultProps: {} },
    behavior: { validation: { supported: true } },
    layout: { options: { isContainer: false } },
    ...extra
});

/** The starter blocks: key, name and fields. */
export const STARTER_BLOCKS: readonly { key: string; name: Text; fields: object[] }[] = [
    {
        key: 'block-applicant',
        name: text('አመልካች', 'Applicant'),
        fields: [
            value('applicant', 'RegistryLookup', text('አመልካች', 'Applicant'), { provider: 'person', required: true }),
            value(
                'applicantRole',
                'RadioButton',
                text('አመልካቹ', 'The applicant is'),
                { required: true },
                {
                    classification: 'internal',
                    data: {
                        defaultProps: {},
                        dataSource: {
                            staticData: [
                                { label: text('ባለቤቱ', 'The owner'), value: 'owner' },
                                { label: text('ወኪሉ', 'A representative'), value: 'representative' }
                            ]
                        }
                    }
                }
            ),
            value(
                'powerOfAttorney',
                'FileUpload',
                text('የውክልና ሰነድ', 'Power of attorney'),
                { required: true, multiple: false },
                {
                    behavior: {
                        validation: { supported: true },
                        visibilityConditions: [{ field: 'applicantRole', operator: 'eq', value: 'representative' }]
                    }
                }
            )
        ]
    },
    {
        key: 'block-vehicle',
        name: text('ተሽከርካሪ', 'Vehicle'),
        fields: [
            value(
                'vehicle',
                'RegistryLookup',
                text('ተሽከርካሪ', 'Vehicle'),
                { provider: 'vehicle', required: true },
                {
                    classification: 'internal'
                }
            )
        ]
    },
    {
        key: 'block-payment',
        name: text('ክፍያ', 'Payment'),
        fields: [
            {
                id: 'fee',
                type: 'Fee',
                category: 'Data',
                label: text('ክፍያ', 'Fee'),
                props: { showLines: true },
                data: { defaultProps: {} },
                behavior: {},
                layout: { options: { isContainer: false } }
            }
        ]
    },
    {
        key: 'block-attachments',
        name: text('አባሪዎች', 'Attachments'),
        fields: [value('attachments', 'FileUpload', text('ተጨማሪ ሰነዶች', 'Supporting documents'), { multiple: true })]
    },
    {
        key: 'block-officer-remarks',
        name: text('የባለሙያ አስተያየት', 'Officer remarks'),
        fields: [
            value(
                'officerRemarks',
                'InputTextarea',
                text('አስተያየት', 'Remarks'),
                { maxLength: 1000 },
                {
                    classification: 'internal'
                }
            )
        ]
    },
    {
        key: 'block-approval-signoff',
        name: text('የማጽደቂያ ፊርማ', 'Approval sign-off'),
        fields: [
            value(
                'approvedOn',
                'EthDate',
                text('የጸደቀበት ቀን', 'Approved on'),
                { required: true },
                {
                    classification: 'internal'
                }
            ),
            value(
                'approverSignature',
                'Signature',
                text('የአጽዳቂው ፊርማ', "Approver's signature"),
                { required: true },
                {
                    classification: 'internal'
                }
            )
        ]
    }
];

/** Each starter block at the region's root, published as its first version. Returns how many were made. */
export async function importStarterBlocks(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    let made = 0;
    for (const block of STARTER_BLOCKS) {
        const [existing] = await tx
            .select({ id: formDefinitions.id })
            .from(formDefinitions)
            .where(and(eq(formDefinitions.regionId, root.regionId), eq(formDefinitions.key, block.key)));
        if (existing) continue;
        const document = { schemaVersion: 2, fields: block.fields };
        const hash = contentHash(document);
        const form = await insertAudited(tx, formDefinitions, {
            regionId: root.regionId,
            ownerUnitId: root.id,
            key: block.key,
            name: block.name,
            kind: 'block',
            category: 'Blocks',
            document,
            documentHash: hash
        });
        const version = await insertAudited(tx, formVersions, {
            regionId: root.regionId,
            ownerUnitId: root.id,
            formId: form.id,
            number: 1,
            contentHash: hash,
            document
        });
        await updateAudited(tx, formDefinitions, form.id, form.rowVersion, {
            publishedVersionId: version.id,
            publishedAt: new Date()
        });
        made += 1;
    }
    return made;
}
