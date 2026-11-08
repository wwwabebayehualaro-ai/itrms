/**
 * The language the browser spells dates in (month and weekday names): the page's own (`<html lang>`, which the app's root
 * layout sets), or Amharic for a language Intl has no names for (wal-Latn reads Amharic, as its texts fall back to).
 */
export function pageLocale(lang?: string): string {
    const wanted = lang || (typeof document === 'undefined' ? '' : document.documentElement.lang) || 'en';
    try {
        return Intl.DateTimeFormat.supportedLocalesOf(wanted).length > 0 ? wanted : 'am';
    } catch {
        return 'am';
    }
}
