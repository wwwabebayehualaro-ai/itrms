/**
 * next-intl's request configuration (task 0.13). The language is the person's preference, kept on the server and
 * mirrored in the `itrms_lang` cookie so the server renders in it from the first byte; not in the URL (ADR-0028: links
 * are shared between colleagues who read different languages). Amharic by default.
 */
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { LANGUAGE_COOKIE } from '@/lib/auth/cookies';
import { DEFAULT_LANGUAGE, isUiLanguage, messagesFor } from './messages';

export default getRequestConfig(async () => {
    const asked = (await cookies()).get(LANGUAGE_COOKIE)?.value;
    const locale = isUiLanguage(asked) ? asked : DEFAULT_LANGUAGE;
    return {
        locale,
        messages: messagesFor(locale),
        timeZone: 'Africa/Addis_Ababa',
        // a missing text shows its key in development, the fallback chain having been tried already
        getMessageFallback: ({ namespace, key }) => [namespace, key].filter(Boolean).join('.')
    };
});
