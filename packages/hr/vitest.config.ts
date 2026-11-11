import { defineConfig } from 'vitest/config';
const p = (rel: string) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export default defineConfig({ resolve: { alias: { '@o-pharmacy/core': p('../core/src/index.ts'), '@o-pharmacy/hub': p('../hub/src/index.ts'), '@o-pharmacy/ops': p('../ops/src/index.ts'), '@o-pharmacy/inventory': p('../inventory/src/index.ts'), '@o-pharmacy/pos': p('../pos/src/index.ts') } } });
