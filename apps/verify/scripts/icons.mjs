// Draws the app's neutral icons into public/icons: a white check on green, no bureau's mark. Run by hand if the icon changes; the PNGs
// are committed. `node scripts/icons.mjs`
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pngjs from 'pngjs';

const { PNG } = pngjs;

const HERE = dirname(fileURLToPath(import.meta.url));

const GREEN = [10, 107, 53];
const WHITE = [255, 255, 255];

const distance = (x, y, [ax, ay], [bx, by]) => {
    const t = Math.max(
        0,
        Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2))
    );
    return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
};

for (const size of [192, 512]) {
    const png = new PNG({ width: size, height: size });
    for (let y = 0; y < size; y += 1)
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const v = y / size;
            const stroke = Math.min(
                distance(u, v, [0.27, 0.52], [0.44, 0.69]),
                distance(u, v, [0.44, 0.69], [0.74, 0.33])
            );
            const [r, g, b] = stroke < 0.055 ? WHITE : GREEN;
            const at = (y * size + x) * 4;
            png.data[at] = r;
            png.data[at + 1] = g;
            png.data[at + 2] = b;
            png.data[at + 3] = 255;
        }
    const dir = join(HERE, '..', 'public', 'icons');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `icon-${size}.png`), PNG.sync.write(png));
}
