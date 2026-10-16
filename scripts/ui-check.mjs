/**
 * Visual + functional smoke check of the PWA.
 * Loads the app in a mobile viewport, signs in and captures screenshots of
 * the main screens. Run with: node scripts/ui-check.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const outDir = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(String(error)));

async function shot(name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log('captured', name);
}

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

if (await page.locator('input[type=password]').count()) {
  await page.fill('input[type=email]', 'admin@visahobe.local');
  await page.fill('input[type=password]', 'VisaHOBe!2024');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2000);
}
await shot('01-home');

for (const [label, file] of [
  ['Agents', '02-agents'],
  ['Chat', '03-chat'],
  ['Cases', '04-cases'],
  ['Documents', '05-documents'],
  ['More', '06-more'],
]) {
  const item = page.locator('.bottom-nav .nav-item', { hasText: label }).first();
  if (await item.count()) {
    await item.click();
    await page.waitForTimeout(1400);
    await shot(file);
  }
}

// Agent profile screen
await page.goto(`${base}/agents/raffi`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('07-agent-profile');

// Browser automation screen with a real live preview
await page.goto(`${base}/browser`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const session = await page.evaluate(async () => {
  const created = await fetch('/api/browser/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'ui-check', viewport: 'desktop' }),
  });
  if (!created.ok) return { error: created.status };
  const session = await created.json();
  await fetch(`/api/browser/sessions/${session.session.id}/navigate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1:4599/index.html' }),
  });
  return { id: session.session.id };
});
console.log('browser session:', JSON.stringify(session));
await page.waitForTimeout(4000);
await shot('08-browser-live-preview');

// Desktop rendering
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const desktopPage = await desktop.newPage();
await desktopPage.goto(base, { waitUntil: 'networkidle' });
await desktopPage.waitForTimeout(1200);
if (await desktopPage.locator('input[type=password]').count()) {
  await desktopPage.fill('input[type=email]', 'admin@visahobe.local');
  await desktopPage.fill('input[type=password]', 'VisaHOBe!2024');
  await desktopPage.click('button[type=submit]');
  await desktopPage.waitForTimeout(2000);
}
await desktopPage.screenshot({ path: `${outDir}09-desktop-home.png` });
console.log('captured 09-desktop-home');

console.log('console errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
