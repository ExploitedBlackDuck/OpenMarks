import esbuild from '../node_modules/esbuild/lib/main.js';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

await mkdir('.test-build', { recursive: true });
await esbuild.build({
  entryPoints: ['src/storage.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/storage.mjs',
  plugins: [{ name: 'obsidian-test-api', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve('tests/obsidian-mock.mjs'), external: true }));
  } }],
});
await esbuild.build({ entryPoints: ['src/model.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/model.mjs' });
await esbuild.build({ entryPoints: ['src/security.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/security.mjs' });
await esbuild.build({ entryPoints: ['src/import-export.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/import-export.mjs' });
await esbuild.build({ entryPoints: ['src/ui-behavior.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/ui-behavior.mjs' });
await esbuild.build({ entryPoints: ['src/bulk.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/bulk.mjs' });
await esbuild.build({ entryPoints: ['src/favicon-queue.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/favicon-queue.mjs' });
await esbuild.build({ entryPoints: ['src/favicon-policy.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/favicon-policy.mjs' });
await esbuild.build({ entryPoints: ['src/favicon-cache.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/favicon-cache.mjs' });
await esbuild.build({ entryPoints: ['src/sample-data.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/sample-data.mjs' });
await esbuild.build({ entryPoints: ['src/refresh-scheduler.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/refresh-scheduler.mjs' });
await esbuild.build({
  entryPoints: ['src/metadata.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/metadata.mjs',
  plugins: [{ name: 'obsidian-test-api', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve('tests/obsidian-mock.mjs'), external: true }));
  } }],
});
await esbuild.build({
  entryPoints: ['src/ui.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/ui.mjs',
  plugins: [{ name: 'obsidian-test-api', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve('tests/obsidian-mock.mjs'), external: true }));
  } }],
});
