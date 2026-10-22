import { PersonEdit } from '@/screens/registry/PersonEdit';

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <PersonEdit id={id} />;
}
