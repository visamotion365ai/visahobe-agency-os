/**
 * Development launcher: starts the API, the browser worker, the static web app
 * and the controlled local test site in one terminal.
 *
 *   node scripts/dev.mjs
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

const processes = [
  { name: 'api', color: '\x1b[36m', cmd: 'npx', args: ['tsx', 'watch', 'apps/server/src/index.ts'] },
  { name: 'worker', color: '\x1b[35m', cmd: 'npx', args: ['tsx', 'watch', 'apps/browser-worker/src/index.ts'] },
  { name: 'web', color: '\x1b[32m', cmd: 'npx', args: ['vite', '--host', '0.0.0.0', '--port', '5173'], cwd: 'apps/web' },
  { name: 'test-site', color: '\x1b[33m', cmd: 'node', args: ['scripts/test-site.mjs'] },
];

const children = [];
for (const item of processes) {
  const child = spawn(item.cmd, item.args, {
    cwd: resolve(root, item.cwd ?? '.'),
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `${item.color}[${item.name}]\x1b[0m `;
  const pipe = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
  });
  children.push(child);
}

const shutdown = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.stdout.write(
  `\nVisaHOBe dev stack\n` +
    `  web        http://localhost:5173\n` +
    `  api        http://127.0.0.1:8787\n` +
    `  test site  http://127.0.0.1:4599\n` +
    `  worker     ws://127.0.0.1:8787/api/browser/worker\n\n`,
);
