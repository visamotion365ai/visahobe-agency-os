import { chromium, type Browser } from 'playwright';

let browserPromise: Promise<Browser> | null = null;
let disabled = false;

async function getBrowser(): Promise<Browser> {
  if (disabled) throw new Error('PDF rendering is unavailable in this environment');
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

export function isPdfAvailable(): boolean {
  return !disabled;
}

/**
 * Render HTML to a print-quality A4 PDF using the locally installed Chromium.
 * No external service is involved.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    disabled = true;
    throw new Error(
      `PDF rendering is unavailable: ${(err as Error).message}. Install the browser with "npx playwright install chromium".`,
    );
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

export async function closeRenderer(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    /* ignore */
  }
  browserPromise = null;
}
