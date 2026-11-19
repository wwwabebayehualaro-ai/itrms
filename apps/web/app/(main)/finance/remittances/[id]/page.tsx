import { RemittancePage } from '@/screens/fees/RemittancePage';

export default async function RemittanceRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <RemittancePage id={id} />;
}
