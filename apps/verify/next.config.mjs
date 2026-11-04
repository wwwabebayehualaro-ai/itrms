import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A static export (ADR-0032): no server, no session. Nginx serves `out/` on `verify.<domain>`. */
export default {
    output: 'export',
    images: { unoptimized: true },
    poweredByHeader: false,
    turbopack: { root: monorepoRoot },
    transpilePackages: ['@itrms/ethiopian-calendar']
};
