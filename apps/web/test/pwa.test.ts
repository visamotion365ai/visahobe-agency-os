import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(__dirname, '..');

describe('PWA installation configuration', () => {
  it('ships a valid web app manifest', () => {
    const manifestPath = resolve(webRoot, 'public', 'manifest.webmanifest');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
    const sizes = manifest.icons.map((icon: any) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon: any) => icon.purpose === 'maskable')).toBe(true);
  });

  it('ships the icon files referenced by the manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(webRoot, 'public', 'manifest.webmanifest'), 'utf8'));
    for (const icon of manifest.icons) {
      const path = resolve(webRoot, 'public', icon.src.replace(/^\//, ''));
      expect(existsSync(path), `missing icon ${icon.src}`).toBe(true);
    }
    expect(existsSync(resolve(webRoot, 'public', 'icons', 'apple-touch-icon.png'))).toBe(true);
  });

  it('uses the iOS safe-area and standalone meta tags', () => {
    const html = readFileSync(resolve(webRoot, 'index.html'), 'utf8');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-mobile-web-app-title');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('theme-color');
  });

  it('never caches API responses or private documents in the service worker', () => {
    const sw = readFileSync(resolve(webRoot, 'public', 'sw.js'), 'utf8');
    expect(sw).toContain("url.pathname.startsWith('/api/')");
    expect(sw).toContain('return;');
    expect(sw).not.toMatch(/caches\.put\([^)]*\/api\//);
  });
});

describe('mobile layout rules', () => {
  const css = readFileSync(resolve(webRoot, 'src', 'styles.css'), 'utf8');

  it('keeps form controls at 16px so iOS Safari does not zoom on focus', () => {
    expect(css).toMatch(/input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*16px/);
  });

  it('respects the device safe areas', () => {
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('env(safe-area-inset-bottom)');
  });

  it('renders a floating bottom navigation on mobile and a sidebar on desktop', () => {
    expect(css).toContain('.bottom-nav');
    expect(css).toContain('.sidebar');
    expect(css).toMatch(/@media \(min-width: 1024px\)/);
    expect(css).toMatch(/\.bottom-nav\s*\{[^}]*display:\s*none/);
  });

  it('uses the liquid glass treatment', () => {
    expect(css).toContain('backdrop-filter');
    expect(css).toContain('saturate(');
  });
});
