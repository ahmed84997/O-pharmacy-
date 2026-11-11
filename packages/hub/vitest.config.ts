import { defineConfig } from 'vitest/config';
export default defineConfig({ resolve: { alias: { '@o-pharmacy/core': new URL('../core/src/index.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') } } });
