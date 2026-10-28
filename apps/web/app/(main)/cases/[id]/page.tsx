import { CasePage } from '@/screens/workflow/CasePage';

export default async function CaseRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <CasePage id={id} />;
}
