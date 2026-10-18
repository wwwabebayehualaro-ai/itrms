'use client';

import { useParams } from 'next/navigation';
import { RecordScreen } from '../RecordScreen';

export default function RecordPage() {
    const { templateId, submissionId } = useParams<{ templateId: string; submissionId: string }>();
    return <RecordScreen templateId={templateId} submissionId={submissionId} />;
}
