/**
 * The notices a case shows everyone acting on it (task 1.2e): an effect puts message keys in its own fact as `notices`
 * (`facts.registration.notices`), so that a step taken later sees what an earlier one found, e.g. the lead approving a
 * registration sees that the officer confirmed a chassis check digit that does not match. Only message keys are kept: a notice
 * is always text from the catalogues, never a value typed on the case.
 */
/** A message key as the catalogues spell it: `<owner>.<area>.<key>`. */
const MESSAGE_KEY = /^[a-z][a-z0-9-]*(\.[A-Za-z0-9_-]+){2,}$/;

/** The notices the case's effects raised: `facts.<key>.notices`, message keys only, each once, in the facts' order. */
export function noticesOf(facts: unknown): string[] {
    if (facts === null || typeof facts !== 'object') return [];
    const found = Object.values(facts).flatMap((fact: unknown) => {
        const notices: unknown =
            fact !== null && typeof fact === 'object' && !Array.isArray(fact)
                ? (fact as Record<string, unknown>).notices
                : undefined;
        return Array.isArray(notices)
            ? notices.filter((n): n is string => typeof n === 'string' && MESSAGE_KEY.test(n))
            : [];
    });
    return [...new Set(found)];
}
