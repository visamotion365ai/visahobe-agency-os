/** Renders the VisaHOBe mark into the PNG sizes required by the PWA manifest. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const svg = readFileSync(join(root, 'apps/web/public/logo.svg'), 'utf8');
const outDir = join(root, 'apps/web/public/icons');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function render(size, file, maskable = false) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const padding = maskable ? size * 0.12 : 0;
  await page.setContent(
    `<html><body style="margin:0;width:${size}px;height:${size}px;background:${maskable ? '#0a84ff' : 'transparent'};display:grid;place-items:center">
       <div style="width:${size - padding * 2}px;height:${size - padding * 2}px">${svg.replace(
         /width="64"\s+height="64"/,
         `width="100%" height="100%"`,
       )}</div>
     </body></html>`,
  );
  const buffer = await page.screenshot({ omitBackground: !maskable });
  writeFileSync(join(outDir, file), buffer);
  await page.close();
  console.log('wrote', file, buffer.length, 'bytes');
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', true);
await render(180, 'apple-touch-icon.png');
await browser.close();
