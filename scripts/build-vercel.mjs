/**
 * Build the Vercel serverless function.
 *
 * Bundles the Fastify API into one ESM file so Vercel does not have to install
 * native build tools. Heavy, platform-specific packages (Playwright's Chromium,
 * tesseract language data, the SQLite driver) are left external: the Postgres
 * code path does not need them and the features that do already degrade with a
 * clear message when the binary is missing.
 */
import { build } from 'esbuild';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

mkdirSync('api', { recursive: true });

await build({
  entryPoints: ['api/index.ts'],
  outfile: 'api/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  minify: false,
  // The server is written in NodeNext style (".js" import specifiers that
  // resolve to ".ts" sources). Teach esbuild the same resolution.
  resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
  plugins: [
    {
      name: 'js-to-ts',
      setup(build) {
        // Only rewrite a relative "./x.js" to "./x.ts" when that .ts source
        // actually exists — dependency internals must be left untouched.
        build.onResolve({ filter: /\.js$/ }, (args) => {
          if (!args.importer || !(args.path.startsWith('./') || args.path.startsWith('../'))) return null;
          const candidate = resolve(dirname(args.resolveDir), args.path.replace(/\.js$/, '.ts'));
          return existsSync(candidate) ? { path: candidate } : null;
        });
      },
    },
  ],
  banner: {
    // Some bundled CJS deps expect `require`/`__dirname` to exist in ESM.
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __f2p } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      'const require = __cr(import.meta.url);',
      'const __filename = __f2p(import.meta.url);',
      'const __dirname = __dn(__filename);',
    ].join('\n'),
  },
  external: ['playwright', 'playwright-core', 'tesseract.js', 'better-sqlite3', 'pg-native'],
});

console.log('Vercel function bundled to api/index.mjs');
