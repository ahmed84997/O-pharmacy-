// Bundles the Hub application and all packages into one file (dist/hub.mjs) that runs on plain Node 22+.
import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'dist/hub.mjs',
  tsconfig: 'tsconfig.json', external: ['node:sqlite'], sourcemap: false, legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log('built dist/hub.mjs');
