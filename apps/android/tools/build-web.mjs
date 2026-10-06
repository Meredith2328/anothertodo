import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mobile = resolve('web');
const output = resolve('build/assets');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(mobile, 'app.ts')], outdir: output, bundle: true, minify: true,
  format: 'esm', splitting: true, target: 'chrome90', platform: 'browser',
  inject: [resolve(mobile, 'buffer.ts')],
  define: { 'process.env': '{}', 'global': 'globalThis' },
  plugins: [{ name: 'android-adapters', setup(builder) {
    builder.onResolve({ filter: /config\.js$/ }, args => args.importer.includes('src/core/') || args.importer.includes('src\\core\\') || args.path.includes('core/config') ? ({ path: resolve(mobile, 'config.ts') }) : undefined);
    builder.onResolve({ filter: /sync\/sync\.js$/ }, () => ({ path: resolve(mobile, 'sync.ts') }));
    builder.onResolve({ filter: /reminders\/watcher\.js$/ }, () => ({ path: resolve(mobile, 'reminders.ts') }));
    builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: resolve(mobile, 'crypto.ts') }));
    builder.onResolve({ filter: /^node:events$/ }, () => ({ path: resolve('../../node_modules/events/events.js') }));
  } }],
});
for (const name of ['index.html', 'style.css']) await copyFile(resolve(mobile, name), resolve(output, name));
