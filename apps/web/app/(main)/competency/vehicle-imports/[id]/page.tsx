import { VehicleImportReport } from '@/screens/competency/VehicleImportScreens';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <VehicleImportReport id={id} />;
}
