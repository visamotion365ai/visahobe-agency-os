/**
 * Tiny static server for the controlled local test site used by the browser
 * automation tests. It is intentionally minimal and serves only the fixture
 * folder — never a live government portal.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'apps', 'server', 'test', 'fixtures', 'site');
const port = Number(process.env.TEST_SITE_PORT ?? 4599);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': types[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`[test-site] http://127.0.0.1:${port}`);
});
