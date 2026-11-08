import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations();
    return {
        // the product's name, the same in every language
        title: t('shell.app.name'),
        description: t('shell.app.description')
    };
}

/** Pages outside the application frame (sign-in, errors, landing). */
export default function SimpleLayout({ children }: { children: React.ReactNode }) {
    return children;
}
