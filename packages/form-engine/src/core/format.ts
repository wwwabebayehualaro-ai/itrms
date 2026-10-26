/** How a number field's value reads (grouping, currency, fraction digits): shared by the screen and the printout. */
const num = (v: unknown) =>
    v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);

/** The formatter for a number field's settings (`props`); the field's own `locale` wins over `locale`. */
export function numberFormatOf(props: Record<string, unknown>, locale?: string): Intl.NumberFormat {
    const currency = typeof props.currency === 'string' ? props.currency : undefined;
    const minFd = num(props.minFractionDigits);
    const maxFd = num(props.maxFractionDigits);
    try {
        return new Intl.NumberFormat((typeof props.locale === 'string' && props.locale) || locale || undefined, {
            style: props.mode === 'currency' && currency ? 'currency' : 'decimal',
            currency: currency || undefined,
            minimumFractionDigits: minFd,
            maximumFractionDigits: maxFd !== undefined ? Math.max(maxFd, minFd ?? 0) : undefined,
            useGrouping: props.useGrouping !== false
        });
    } catch {
        return new Intl.NumberFormat(locale);
    }
}
