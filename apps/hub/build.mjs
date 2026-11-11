// Bundles the Hub application and all packages into one file (dist/hub.mjs) that runs on plain Node 22+.
import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'dist/hub.mjs',
  tsconfig: 'tsconfig.json', external: ['node:sqlite', '@napi-rs/canvas', '@fontsource/ibm-plex-sans-arabic'], nodePaths: ['node_modules'], sourcemap: false, legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
// The native canvas (receipt pictures) and the font are installed next to hub.mjs (npm install in dist/ or in the installer).
import { writeFileSync, readFileSync } from 'node:fs';
const deps = JSON.parse(readFileSync('package.json', 'utf8')).dependencies;
writeFileSync('dist/package.json', JSON.stringify({ name: 'o-pharmacy-hub-runtime', private: true, type: 'module', dependencies: { '@napi-rs/canvas': deps['@napi-rs/canvas'], '@fontsource/ibm-plex-sans-arabic': deps['@fontsource/ibm-plex-sans-arabic'] } }, null, 2));
console.log('built dist/hub.mjs and dist/package.json');
