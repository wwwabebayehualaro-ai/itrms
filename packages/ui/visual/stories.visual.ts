// One screenshot per story and language, taken from the built Storybook once the story has finished: rendered and its
// play function done (an opened menu, a shown toast). A story tagged `no-visual` is skipped (for content a screenshot
// can't pin); axe still runs on it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

interface IndexEntry {
    id: string;
    type: 'story' | 'docs';
    tags?: string[];
}

const index = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'storybook-static', 'index.json'), 'utf8')) as {
    entries: Record<string, IndexEntry>;
};
const stories = Object.values(index.entries).filter((e) => e.type === 'story' && !e.tags?.includes('no-visual'));

/**
 * Storybook 10 emits `storyFinished` once a story has rendered, played and run its afterEach hooks, with status `error`
 * if anything failed on the way: a thrown error, an error the play function caused but did not catch, a failed report.
 * The render phase alone can't tell: a story with an uncaught error still ends in `finished`, with no error display.
 */
interface PreviewWindow {
    __STORYBOOK_ADDONS_CHANNEL__?: { last(event: string): [{ storyId: string; status: string }] | undefined };
}

for (const story of stories) {
    test(story.id, async ({ page }, info) => {
        const globals = `locale:${info.project.name};theme:light;density:comfortable`;
        await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=${globals}`);
        const status = await page.waitForFunction((id) => {
            const finished = (window as PreviewWindow).__STORYBOOK_ADDONS_CHANNEL__?.last('storyFinished')?.[0];
            return finished?.storyId === id ? finished.status : false;
        }, story.id);
        expect(await status.jsonValue(), 'the story renders and its play function passes').toBe('success');
        // the self-hosted fonts must be in before the picture is taken
        await page.evaluate(async () => {
            await document.fonts.ready;
        });
        await expect(page).toHaveScreenshot(`${story.id}.png`, { fullPage: true });
    });
}
