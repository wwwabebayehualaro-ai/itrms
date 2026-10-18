import { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Digital File Cabinet',
    description: 'Build dynamic forms, collect submissions and manage the files behind them.'
};

/** Pages outside the application frame (sign-in, errors, landing). */
export default function SimpleLayout({ children }: { children: React.ReactNode }) {
    return children;
}
