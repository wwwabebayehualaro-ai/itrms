import { FileQuestion } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { StatusScreen } from './(full-page)/StatusScreen';

/** The app's 404 page (any unknown URL). */
export default async function NotFound() {
    const t = await getTranslations();
    return (
        <StatusScreen
            icon={FileQuestion}
            code="404"
            title={t('shell.status.notFound.title')}
            message={t('shell.status.notFound.message')}
        />
    );
}
