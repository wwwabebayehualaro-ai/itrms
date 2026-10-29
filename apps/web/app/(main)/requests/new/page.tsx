import { RequestNew } from '@/screens/services/RequestNew';

export default async function RequestNewRoute({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
    const { service } = await searchParams;
    return <RequestNew initial={service} />;
}
