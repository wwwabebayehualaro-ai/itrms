import { ReceiptPage } from '@/screens/fees/ReceiptPage';

export default async function ReceiptRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <ReceiptPage id={id} />;
}
