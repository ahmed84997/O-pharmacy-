// Build a Node single-executable application (SEA) on the CURRENT OS. Unsigned (signing is deferred, D28).
import { execFileSync } from 'node:child_process';
import { copyFileSync, writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist'); mkdirSync(dist, { recursive: true });
const exe = join(dist, platform() === 'win32' ? 'hub-health.exe' : 'hub-health');
writeFileSync(join(dist, 'sea-config.json'), JSON.stringify({ main: join(here, 'health.cjs'), output: join(dist, 'sea-prep.blob'), disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', join(dist, 'sea-config.json')], { stdio: 'inherit' });
copyFileSync(process.execPath, exe);
if (platform() === 'darwin') execFileSync('codesign', ['--remove-signature', exe]);
const args = [join(here, 'node_modules', 'postject', 'dist', 'cli.js'), exe, 'NODE_SEA_BLOB', join(dist, 'sea-prep.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (platform() === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.execPath, args, { stdio: 'inherit' });
if (platform() === 'darwin') execFileSync('codesign', ['--sign', '-', exe]);
const out = execFileSync(exe, ['--once'], { env: { ...process.env } }).toString().trim();
console.log(JSON.stringify({ built: exe, sizeMB: +(statSync(exe).size / 1048576).toFixed(1), run: JSON.parse(out) }));
