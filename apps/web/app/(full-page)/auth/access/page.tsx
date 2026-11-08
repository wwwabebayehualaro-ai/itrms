import { ShieldX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { StatusScreen } from '../../StatusScreen';

export default async function AccessDeniedPage() {
    const t = await getTranslations();
    return (
        <StatusScreen
            icon={ShieldX}
            code="403"
            title={t('shell.status.accessDenied.title')}
            message={t('shell.status.accessDenied.message')}
        />
    );
}
