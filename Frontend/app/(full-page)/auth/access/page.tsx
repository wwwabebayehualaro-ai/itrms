import { ShieldX } from 'lucide-react';
import { StatusScreen } from '../../StatusScreen';

export default function AccessDeniedPage() {
    return <StatusScreen icon={ShieldX} code="403" title="Access denied" message="Your account does not have permission to open this page. Ask your workspace administrator if you need it." />;
}
