import { defineConfig } from 'vitest/config';
const p = (rel: string) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export default defineConfig({ resolve: { alias: { '@o-pharmacy/core': p('../core/src/index.ts'), '@o-pharmacy/hub': p('../hub/src/index.ts') } } });
