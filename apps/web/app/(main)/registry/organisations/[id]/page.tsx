import { OrganisationRecord } from '@/screens/registry/Organisations';

export default async function OrganisationPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <OrganisationRecord id={id} />;
}
