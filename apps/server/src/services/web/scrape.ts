import { chromium, type Browser } from 'playwright';
import { env } from '../../env.js';
import { assertUrlAllowed } from '../../browser/ssrf.js';

export interface ScrapedPage {
  url: string;
  title: string;
  text: string;
  links: Array<{ href: string; text: string }>;
  retrievedAt: string;
  source: 'firecrawl' | 'playwright-fallback';
  status?: number;
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }
  return browserPromise;
}

export async function closeScraper(): Promise<void> {
  if (!browserPromise) return;
  try {
    (await browserPromise).close();
  } catch {
    /* ignore */
  }
  browserPromise = null;
}

/** Self-hosted Firecrawl (optional). */
async function scrapeWithFirecrawl(url: string): Promise<ScrapedPage | null> {
  if (!env.FIRECRAWL_URL) return null;
  try {
    const res = await fetch(`${env.FIRECRAWL_URL.replace(/\/$/, '')}/v1/scrape`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.FIRECRAWL_API_KEY ? { authorization: `Bearer ${env.FIRECRAWL_API_KEY}` } : {}),
      },
      body: JSON.stringify({ url, formats: ['markdown', 'links'], onlyMainContent: true }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const data = json?.data ?? json;
    return {
      url,
      title: data?.metadata?.title ?? data?.title ?? '',
      text: String(data?.markdown ?? data?.content ?? '').slice(0, 200000),
      links: (data?.links ?? []).slice(0, 200).map((l: any) => ({
        href: typeof l === 'string' ? l : l.url,
        text: typeof l === 'string' ? '' : (l.text ?? l.title ?? ''),
      })),
      retrievedAt: new Date().toISOString(),
      source: 'firecrawl',
      status: data?.metadata?.statusCode,
    };
  } catch {
    return null;
  }
}

/** Playwright based extraction fallback — no third-party service required. */
async function scrapeWithPlaywright(url: string): Promise<ScrapedPage> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: 'VisaHOBeAgencyOS/1.0 (+self-hosted web intelligence)' });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const title = await page.title();
    const text = await page.evaluate(() => {
      const root = document.querySelector('main') ?? document.body;
      return (root?.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 200000);
    });
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 300)
        .map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? '').trim().slice(0, 160) })),
    );
    return {
      url,
      title,
      text,
      links,
      retrievedAt: new Date().toISOString(),
      source: 'playwright-fallback',
      status: response?.status(),
    };
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

export async function scrapePage(rawUrl: string): Promise<ScrapedPage> {
  await assertUrlAllowed(rawUrl);
  const firecrawl = await scrapeWithFirecrawl(rawUrl);
  if (firecrawl) return firecrawl;
  return scrapeWithPlaywright(rawUrl);
}
