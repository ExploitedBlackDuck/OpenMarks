import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const out = resolve(root, 'release');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
for (const file of ['main.js', 'manifest.json', 'styles.css']) await readFile(resolve(root, file));
if (manifest.id !== 'openmarks' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Manifest ID or version is invalid.');
await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'openmarks'), { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await cp(resolve(root, file), resolve(out, 'openmarks', file));
const zipPath = resolve(out, `openmarks-${manifest.version}.zip`);
const result = spawnSync('zip', ['-qr', zipPath, 'openmarks'], { cwd: out, stdio: 'inherit' });
if (result.status !== 0) throw new Error('ZIP utility failed while packaging the release.');
const listing = spawnSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
if (listing.status !== 0 || !['openmarks/main.js', 'openmarks/manifest.json', 'openmarks/styles.css'].every((name) => listing.stdout.includes(name)) || listing.stdout.includes('sample-data.json')) throw new Error('Release ZIP does not contain the expected self-contained plugin files.');
console.log(`Created ${zipPath}`);
