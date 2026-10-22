import { PersonRecord } from '@/screens/registry/PersonRecord';

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <PersonRecord id={id} />;
}
