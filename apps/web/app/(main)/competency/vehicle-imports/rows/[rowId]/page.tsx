import { VehicleImportRowPage } from '@/screens/competency/VehicleImportScreens';

export default async function Page({ params }: { params: Promise<{ rowId: string }> }) {
    const { rowId } = await params;
    return <VehicleImportRowPage rowId={rowId} />;
}
