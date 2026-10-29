import { ServiceDetail } from '@/screens/services/ServiceDetail';

export default async function ServiceRoute({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;
    return <ServiceDetail code={code} />;
}
