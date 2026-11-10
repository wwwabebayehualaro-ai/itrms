import { VehicleRecord } from '@/screens/registry/VehicleRecord';

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <VehicleRecord id={id} />;
}
