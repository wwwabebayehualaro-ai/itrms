import { FileQuestion } from 'lucide-react';
import { StatusScreen } from './(full-page)/StatusScreen';

/** The app's 404 page (any unknown URL). */
export default function NotFound() {
    return <StatusScreen icon={FileQuestion} code="404" title="Page not found" message="This page does not exist or was moved. Check the address, or start again from the dashboard." />;
}
