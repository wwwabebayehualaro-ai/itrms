/** Merging a resumed draft's answers (task 0.20c): pure, so it is tested on its own. */

/**
 * The server's answers with this browser's over them. A repeating section's rows are merged row by row when both have
 * as many rows (a row's answers kept on the server only stay); with rows added or taken out here, this browser's rows
 * stand (those answers are typed again rather than put on the wrong row).
 */
export function mergeAnswers(server: Record<string, unknown>, local: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...server };
    for (const [key, value] of Object.entries(local)) {
        const before = server[key];
        out[key] =
            Array.isArray(value) && Array.isArray(before) && value.length === before.length
                ? value.map((row: unknown, i) => {
                      const was: unknown = before[i];
                      return isRecord(row) && isRecord(was) ? mergeAnswers(was, row) : row;
                  })
                : value;
    }
    return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
