import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const out = resolve(root, 'release');
const version = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')).version;
const packageVersion = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
if (packageVersion !== version) throw new Error(`Version mismatch: package.json has ${packageVersion}, manifest.json has ${version}`);
const pluginFiles = ['main.js', 'manifest.json', 'styles.css'];
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

async function zipFrom(name, source, archiveRoot, ignore = () => false) {
  const staging = resolve(out, `.stage-${name}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  async function copyTree(from, to) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (ignore(entry.name, from)) continue;
      const src = resolve(from, entry.name); const dest = resolve(to, entry.name);
      if (entry.isDirectory()) await copyTree(src, dest); else await cp(src, dest);
    }
  }
  await copyTree(source, resolve(staging, archiveRoot));
  const archive = resolve(out, name);
  const packed = spawnSync('zip', ['-qr', archive, archiveRoot], { cwd: staging, stdio: 'inherit' });
  if (packed.status !== 0) throw new Error(`Could not create ${name}`);
  const checked = spawnSync('unzip', ['-tq', archive], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(`ZIP integrity check failed: ${name}`);
  await rm(staging, { recursive: true, force: true });
  console.log(`Verified ${archive}`);
  return archive;
}

function verifyArchiveVersion(archive, manifestPath, expected) {
  const result = spawnSync('unzip', ['-p', archive, manifestPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Could not read ${manifestPath} from ${archive}`);
  const found = JSON.parse(result.stdout).version;
  if (found !== expected) throw new Error(`Version mismatch in ${archive}: expected ${expected}, found ${found}`);
}

const demo = resolve(root, 'demo-vault');
await rm(resolve(demo, '.obsidian/plugins/openmarks/sample-data.json'), { force: true });
const marksDir = resolve(demo, '_openmarks/bookmarks');
const marks = (await readdir(marksDir)).filter((name) => name.endsWith('.md'));
if (marks.length !== 100) throw new Error(`Demo vault must have 100 bookmarks, found ${marks.length}`);
await mkdir(resolve(demo, '.obsidian/plugins/openmarks'), { recursive: true });
for (const file of pluginFiles) await cp(resolve(root, file), resolve(demo, '.obsidian/plugins/openmarks', file));
const demoManifest = JSON.parse(await readFile(resolve(demo, '.obsidian/plugins/openmarks/manifest.json'), 'utf8'));
if (demoManifest.version !== version) throw new Error(`Demo plugin version mismatch: expected ${version}, found ${demoManifest.version}`);
await mkdir(resolve(demo, '.obsidian'), { recursive: true });
await writeFile(resolve(demo, '.obsidian/community-plugins.json'), '[\n  "openmarks"\n]\n');
await writeFile(resolve(demo, '.obsidian/app.json'), JSON.stringify({ readableLineLength: true, strictLineBreaks: false }, null, 2) + '\n');
await writeFile(resolve(demo, 'Start Here.md'), `# OpenMarks demo vault\n\nThis isolated vault contains 100 neutral sample bookmarks across eight collections. The sample notes are clearly marked as demonstration data. You can edit or delete them freely.\n\nOpen **OpenMarks** from the ribbon or run **Open bookmark manager** from the Command Palette. Search, collection navigation, favorites, unread status, sorting, and all four display modes are available. Cached favicons work offline when present; unsupported or unavailable icons use the built-in fallback. OpenMarks does not download webpage preview images because it cannot safely constrain redirect destinations. Any preview files already cached in this vault remain available.\n\nThis vault is separate from any other Obsidian vault. OpenMarks does not restrict what lawful HTTP or HTTPS sites you save.\n`);

const pluginStage = resolve(out, 'plugin'); await mkdir(resolve(pluginStage, 'openmarks'), { recursive: true });
for (const file of pluginFiles) await cp(resolve(root, file), resolve(pluginStage, 'openmarks', file));
const pluginZip = resolve(out, `openmarks-${version}.zip`);
const pluginPack = spawnSync('zip', ['-qr', pluginZip, 'openmarks'], { cwd: pluginStage, stdio: 'inherit' });
if (pluginPack.status !== 0 || spawnSync('unzip', ['-tq', pluginZip], { encoding: 'utf8' }).status !== 0) throw new Error('Plugin ZIP failed validation.');
const listing = spawnSync('unzip', ['-l', pluginZip], { encoding: 'utf8' }).stdout;
if (!pluginFiles.every((file) => listing.includes(`openmarks/${file}`))) throw new Error('Plugin ZIP is missing runtime files.');
if (listing.includes('sample-data.json')) throw new Error('Community plugin ZIP must not depend on a separate sample-data asset.');
verifyArchiveVersion(pluginZip, 'openmarks/manifest.json', version);
console.log(`Verified ${pluginZip}`);

const sourceZip = `openmarks-source-${version}.zip`;
const sourceArchive = await zipFrom(sourceZip, root, 'openmarks-source', (name, parent) => name === 'node_modules' || name === '.git' || name === '.test-build' || name === 'release' || (parent === root && name.endsWith('.zip')));
verifyArchiveVersion(sourceArchive, 'openmarks-source/manifest.json', version);
const sourcePackageVersion = JSON.parse(spawnSync('unzip', ['-p', sourceArchive, 'openmarks-source/package.json'], { encoding: 'utf8' }).stdout).version;
if (sourcePackageVersion !== version) throw new Error(`Version mismatch in source archive package.json: expected ${version}, found ${sourcePackageVersion}`);
const demoZip = `openmarks-demo-vault-${version}.zip`;
const demoArchive = await zipFrom(demoZip, demo, 'OpenMarks Demo Vault');
verifyArchiveVersion(demoArchive, 'OpenMarks Demo Vault/.obsidian/plugins/openmarks/manifest.json', version);

const installer = resolve(out, 'installer'); await mkdir(resolve(installer, 'openmarks'), { recursive: true });
for (const file of pluginFiles) await cp(resolve(root, file), resolve(installer, 'openmarks', file));
for (const file of ['install-openmarks.command', 'uninstall-openmarks.command', 'LICENSE']) await cp(resolve(root, file), resolve(installer, file));
await writeFile(resolve(installer, 'README.md'), `# OpenMarks ${version} macOS installer\n\nRun install-openmarks.command and choose an Obsidian vault. The installer copies main.js, manifest.json, and styles.css. Sample data is compressed inside main.js and decoded only if you choose to install the sample library.\n\nTo remove the plugin, run uninstall-openmarks.command. This preserves bookmark notes in the vault.\n`);
const installerArchive = await zipFrom(`openmarks-macos-installer-${version}.zip`, installer, 'OpenMarks macOS Installer');
verifyArchiveVersion(installerArchive, 'OpenMarks macOS Installer/openmarks/manifest.json', version);

for (const [file, name] of [
  ['INSTALLATION.md', 'OPENMARKS-INSTALLATION.md'],
  ['TEST-REPORT.md', 'OPENMARKS-TEST-REPORT.md'],
  ['README.md', 'README.md'],
  ['CHANGELOG.md', 'CHANGELOG.md'],
  ['LICENSE', 'LICENSE'],
]) await cp(resolve(root, file), resolve(out, name));
console.log(`Release artifacts are in ${out}`);
