const { chromium } = require('playwright');
const WEB = process.env.E2E_WEB || 'http://localhost:3000';
async function open(headless = true) {
    // E2E_CHROMIUM = path to a chromium binary (default: the Linux CI path if present, else Playwright's own browser)
    const exe =
        process.env.E2E_CHROMIUM ||
        (require('fs').existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
    const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1800, height: 5200 } });
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
    return { browser, page };
}
async function login(page, email = 'admin@acme-corp.org', pw = process.env.E2E_PASSWORD || 'Sm0ke-Test-Passw0rd') {
    await page.goto(WEB + '/auth/login', { waitUntil: 'networkidle', timeout: 120000 });
    // type like a user and wait for the button to enable: a value set before React has hydrated is not seen by the form
    await page.locator('#email1').pressSequentially(email, { delay: 5 });
    await page.locator('#password1').pressSequentially(pw, { delay: 5 });
    await page.waitForSelector('button[type=submit]:not([disabled])', { timeout: 30000 });
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 120000 }); // a cold dev server compiles the landing page first
}
// real pointer drag (dnd-kit PointerSensor): press, move in steps, release
async function drag(page, from, to, offset = { x: 0, y: 0 }, anchor = 'center') {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + Math.min(a.height / 2, 30));
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + 40, { steps: 4 });
    const ty =
        anchor === 'top'
            ? b.y + 6
            : anchor === 'bottom'
              ? b.y + b.height - 10
              : b.y + Math.min(b.height / 2, 60) + offset.y;
    await page.mouse.move(b.x + b.width / 2 + offset.x, ty, { steps: 18 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(350);
}
module.exports = { open, login, drag, WEB };
