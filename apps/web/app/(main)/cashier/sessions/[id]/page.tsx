import { CashierSessionPage } from '@/screens/fees/CashierSessionPage';

export default async function CashierSessionRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <CashierSessionPage id={id} />;
}
