import { PaymentOrderPage } from '@/screens/fees/PaymentOrderPage';

export default async function PaymentOrderRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <PaymentOrderPage id={id} />;
}
