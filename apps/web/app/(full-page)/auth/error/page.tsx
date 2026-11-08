import { TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { StatusScreen } from '../../StatusScreen';

export default async function ErrorPage() {
    const t = await getTranslations();
    return (
        <StatusScreen
            icon={TriangleAlert}
            title={t('shell.status.error.title')}
            message={t('shell.status.error.message')}
        />
    );
}
