/** What the public page and the verifier share: their language, their frame, and how they print a day. */
import { useEffect, useState, type ReactNode } from 'react';
import { formatEthiopianLong, toEthiopian } from '@itrms/ethiopian-calendar';

import am from '../messages/am.json';
import en from '../messages/en.json';

export type Language = 'am' | 'en';
export type Words = typeof en;

export const dayOf = (day: string, language: Language) => {
    const [year = 0, month = 0, date = 0] = day.split('-').map(Number);
    return formatEthiopianLong(toEthiopian({ year, month, day: date }), { language });
};

export function Fact({ term, children }: { term: string; children: ReactNode }) {
    return (
        <div className="fact">
            <dt>{term}</dt>
            <dd>{children}</dd>
        </div>
    );
}

export function useLanguage() {
    const [language, setLanguage] = useState<Language>('am');
    return {
        language,
        words: language === 'en' ? en : am,
        other: () => setLanguage(language === 'am' ? 'en' : 'am')
    };
}

/** The app keeps working in flight mode once this has run with a connection. */
const useOfflineApp = () => {
    useEffect(() => {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }, []);
};

export function Frame(props: {
    language: Language;
    words: Words;
    other: () => void;
    title: string;
    children: ReactNode;
}) {
    useOfflineApp();
    return (
        <main lang={props.language}>
            <header>
                <h1>{props.title}</h1>
                <button type="button" onClick={props.other}>
                    {props.words['verify.page.otherLanguage']}
                </button>
            </header>
            {props.children}
        </main>
    );
}
