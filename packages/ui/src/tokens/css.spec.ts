import { expect, it } from 'vitest';

import { renderTokensCss } from './css';

// `pnpm --filter @itrms/ui tokens` rewrites the file (vitest -u); otherwise a stale tokens.css fails here.
it('src/styles/tokens.css is generated from tokens.ts and up to date', async () => {
    await expect(renderTokensCss()).toMatchFileSnapshot('../styles/tokens.css');
});
