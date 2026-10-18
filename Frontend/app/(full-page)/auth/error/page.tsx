import { TriangleAlert } from 'lucide-react';
import { StatusScreen } from '../../StatusScreen';

export default function ErrorPage() {
    return <StatusScreen icon={TriangleAlert} title="Something went wrong" message="The page could not be shown. Try again in a moment; if it keeps happening, tell your workspace administrator." />;
}
