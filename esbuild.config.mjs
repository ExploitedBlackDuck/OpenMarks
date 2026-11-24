import esbuild from 'esbuild';
import fs from 'node:fs';

const production = process.argv[2] === 'production';
const context = await esbuild.context({
  entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'],
  format: 'cjs', target: 'es2020', logLevel: 'info', sourcemap: production ? false : 'inline',
  treeShaking: true, outfile: 'main.js', minify: production,
  banner: { js: "/* OpenMarks · local-first bookmarks for Obsidian */" },
});
if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
  console.log('Watching OpenMarks source...');
}
